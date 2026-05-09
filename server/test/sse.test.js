import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/index.js';
import { TaskStore } from '../src/storage.js';
import { JsonTaskRepo } from '../src/repo.js';
import { ReminderScheduler } from '../src/reminderScheduler.js';

const TEST_SECRET = 'phase6-test-jwt-secret-do-not-use-in-prod';
const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

function makeJwt(sub) {
  return jwt.sign({ sub }, TEST_SECRET, {
    algorithm: 'HS256',
    audience: 'authenticated',
    expiresIn: '5m'
  });
}

function withSupabaseEnv() {
  const saved = {
    AUTH_MODE: process.env.AUTH_MODE,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET
  };
  process.env.AUTH_MODE = 'supabase';
  process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
  return () => {
    if (saved.AUTH_MODE === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = saved.AUTH_MODE;
    if (saved.SUPABASE_JWT_SECRET === undefined) delete process.env.SUPABASE_JWT_SECRET;
    else process.env.SUPABASE_JWT_SECRET = saved.SUPABASE_JWT_SECRET;
  };
}

async function startRealSchedulerServer() {
  const dir = await mkdtemp(path.join(tmpdir(), 'motivateme-sse-'));
  const store = new TaskStore(path.join(dir, 'tasks.json'));
  const repo = new JsonTaskRepo(store);
  const scheduler = new ReminderScheduler(repo);
  const app = createApp({ store, scheduler });
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    store,
    scheduler,
    app,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  };
}

// Lightweight SSE client. Buffers events into an array; tests poll waitFor.
async function sseClient(baseUrl, token = null) {
  const url = token
    ? `${baseUrl}/api/reminders/stream?token=${encodeURIComponent(token)}`
    : `${baseUrl}/api/reminders/stream`;
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal });
  if (!res.ok) {
    controller.abort();
    throw new Error(`SSE connect failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';

  const drain = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (!block.trim()) continue;
          let evtName = 'message';
          const dataLines = [];
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) continue; // heartbeat / comment
            if (line.startsWith('event:')) evtName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length === 0) continue;
          const raw = dataLines.join('\n');
          try {
            events.push({ event: evtName, data: JSON.parse(raw) });
          } catch {
            events.push({ event: evtName, data: raw });
          }
        }
      }
    } catch {
      // abort or socket close — expected during shutdown
    }
  })();

  return {
    events,
    close: async () => {
      controller.abort();
      await drain.catch(() => {});
    },
    async waitFor(predicate, timeoutMs = 1500) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = events.find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return null;
    }
  };
}

async function seedDueTask(store, { userId, title }) {
  const created = await store.create({
    user_id: userId,
    title,
    reminderAt: new Date(Date.now() + 60000).toISOString()
  });
  await store.update(created.id, {
    nextReminderAt: new Date(Date.now() - 1000).toISOString()
  });
  return created;
}

test('off mode: connected client receives the LOCAL_USER_ID reminder', async () => {
  const server = await startRealSchedulerServer();
  let client;
  try {
    const task = await seedDueTask(server.store, {
      userId: '00000000-0000-0000-0000-000000000000',
      title: 'Local task'
    });

    client = await sseClient(server.baseUrl);
    await server.scheduler.checkDueTasks();
    const event = await client.waitFor((e) => e.event === 'reminder');
    assert.ok(event, 'expected a reminder event');
    assert.equal(event.data.taskId, task.id);
    assert.equal(event.data.userId, '00000000-0000-0000-0000-000000000000');
  } finally {
    if (client) await client.close();
    await server.close();
  }
});

test('supabase mode: user A receives only A reminders, user B receives only B reminders', async () => {
  const restore = withSupabaseEnv();
  let server;
  let clientA;
  let clientB;
  try {
    server = await startRealSchedulerServer();

    const taskA = await seedDueTask(server.store, { userId: USER_A, title: 'A task' });
    const taskB = await seedDueTask(server.store, { userId: USER_B, title: 'B task' });

    clientA = await sseClient(server.baseUrl, makeJwt(USER_A));
    clientB = await sseClient(server.baseUrl, makeJwt(USER_B));

    // Both tasks fire in a single tick. The dispatcher must route each to
    // exactly one user's set and never spill across.
    await server.scheduler.checkDueTasks();

    const aEvent = await clientA.waitFor((e) => e.event === 'reminder');
    const bEvent = await clientB.waitFor((e) => e.event === 'reminder');

    assert.ok(aEvent, 'user A should receive a reminder');
    assert.equal(aEvent.data.taskId, taskA.id);
    assert.equal(aEvent.data.userId, USER_A);

    assert.ok(bEvent, 'user B should receive a reminder');
    assert.equal(bEvent.data.taskId, taskB.id);
    assert.equal(bEvent.data.userId, USER_B);

    // Cross-user leakage check: each client must have seen exactly one
    // reminder event with its own task id.
    const aReminders = clientA.events.filter((e) => e.event === 'reminder');
    const bReminders = clientB.events.filter((e) => e.event === 'reminder');
    assert.equal(aReminders.length, 1);
    assert.equal(bReminders.length, 1);
    assert.ok(!aReminders.some((e) => e.data.taskId === taskB.id));
    assert.ok(!bReminders.some((e) => e.data.taskId === taskA.id));
  } finally {
    if (clientA) await clientA.close();
    if (clientB) await clientB.close();
    if (server) await server.close();
    restore();
  }
});

test('supabase mode: a reminder for a user with no connected clients is silently dropped', async () => {
  const restore = withSupabaseEnv();
  let server;
  let clientA;
  try {
    server = await startRealSchedulerServer();
    const taskB = await seedDueTask(server.store, { userId: USER_B, title: 'Lonely B' });

    clientA = await sseClient(server.baseUrl, makeJwt(USER_A));

    // No connection for user B. Dispatching must not throw and must not
    // surface anywhere on user A.
    await server.scheduler.checkDueTasks();

    // Give the buffer time to receive an unintended event if the routing is
    // broken; then assert clientA stayed empty.
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      clientA.events.filter((e) => e.event === 'reminder').length,
      0,
      'user A must not see user B reminders'
    );

    // The map should not have a stale entry for B since they never connected.
    const snapshot = server.app.locals.activeClientUsers();
    assert.ok(!snapshot.has(USER_B));
    assert.equal(snapshot.get(USER_A), 1);

    // Sanity: the task for B did move forward in storage (proving the
    // scheduler ran), even though no SSE went out.
    const persisted = (await server.store.readAll()).find((t) => t.id === taskB.id);
    assert.equal(persisted.reminderCount, 1);
  } finally {
    if (clientA) await clientA.close();
    if (server) await server.close();
    restore();
  }
});

test('disconnected clients are removed from the per-user map', async () => {
  const server = await startRealSchedulerServer();
  let client;
  try {
    client = await sseClient(server.baseUrl);
    let snapshot = server.app.locals.activeClientUsers();
    assert.equal(snapshot.get('00000000-0000-0000-0000-000000000000'), 1);

    await client.close();
    client = null;

    // Give the server's 'close' listener a tick to fire.
    await new Promise((resolve) => setTimeout(resolve, 50));

    snapshot = server.app.locals.activeClientUsers();
    assert.ok(!snapshot.has('00000000-0000-0000-0000-000000000000'));

    // Firing a reminder after disconnect must not throw or revive the entry.
    await seedDueTask(server.store, {
      userId: '00000000-0000-0000-0000-000000000000',
      title: 'Late task'
    });
    await assert.doesNotReject(server.scheduler.checkDueTasks());
    snapshot = server.app.locals.activeClientUsers();
    assert.equal(snapshot.size, 0);
  } finally {
    if (client) await client.close();
    await server.close();
  }
});

test('multiple tabs for the same user each receive the reminder', async () => {
  const server = await startRealSchedulerServer();
  let tabOne;
  let tabTwo;
  try {
    const task = await seedDueTask(server.store, {
      userId: '00000000-0000-0000-0000-000000000000',
      title: 'Two tabs'
    });

    tabOne = await sseClient(server.baseUrl);
    tabTwo = await sseClient(server.baseUrl);

    const snapshot = server.app.locals.activeClientUsers();
    assert.equal(snapshot.get('00000000-0000-0000-0000-000000000000'), 2);

    await server.scheduler.checkDueTasks();

    const e1 = await tabOne.waitFor((e) => e.event === 'reminder');
    const e2 = await tabTwo.waitFor((e) => e.event === 'reminder');
    assert.ok(e1 && e2);
    assert.equal(e1.data.taskId, task.id);
    assert.equal(e2.data.taskId, task.id);
  } finally {
    if (tabOne) await tabOne.close();
    if (tabTwo) await tabTwo.close();
    await server.close();
  }
});
