import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/index.js';
import { TaskStore } from '../src/storage.js';
import { ReminderScheduler } from '../src/reminderScheduler.js';
import { localQuotes } from '../src/content/quotes.js';

async function withServer() {
  const dir = await mkdtemp(path.join(tmpdir(), 'motivateme-'));
  const store = new TaskStore(path.join(dir, 'tasks.json'));
  const scheduler = { on() {}, start() {}, stop() {} };
  const app = createApp({ store, scheduler });
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  };
}

test('creates, lists, and completes tasks', async () => {
  const server = await withServer();
  try {
    const createRes = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Review calculus notes',
        description: 'Chapter 4',
        reminderAt: new Date(Date.now() + 600000).toISOString(),
        reminderOffsetMinutes: 45,
        repeatIntervalMinutes: 30,
        quotePreference: {
          mode: 'wisdom'
        }
      })
    });
    assert.equal(createRes.status, 201);
    const task = await createRes.json();
    assert.equal(task.completed, false);
    assert.equal(task.quotePreference.mode, 'wisdom');
    assert.equal(task.reminderOffsetMinutes, 45);
    assert.equal(task.repeatIntervalMinutes, 30);
    assert.equal(
      new Date(task.nextReminderAt).getTime(),
      new Date(task.reminderAt).getTime() - 45 * 60 * 1000
    );

    const listRes = await fetch(`${server.baseUrl}/api/tasks`);
    const tasks = await listRes.json();
    assert.equal(tasks.length, 1);

    const patchRes = await fetch(`${server.baseUrl}/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true })
    });
    const completed = await patchRes.json();
    assert.equal(completed.completed, true);
  } finally {
    await server.close();
  }
});

test('deletes tasks', async () => {
  const server = await withServer();
  try {
    const createRes = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Delete practice task',
        reminderAt: new Date(Date.now() + 60000).toISOString()
      })
    });
    const task = await createRes.json();

    const deleteRes = await fetch(`${server.baseUrl}/api/tasks/${task.id}`, {
      method: 'DELETE'
    });
    assert.equal(deleteRes.status, 204);

    const listRes = await fetch(`${server.baseUrl}/api/tasks`);
    const tasks = await listRes.json();
    assert.equal(tasks.length, 0);
  } finally {
    await server.close();
  }
});

test('snoozes unfinished tasks', async () => {
  const server = await withServer();
  try {
    const createRes = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Snooze practice task',
        reminderAt: new Date(Date.now() + 60000).toISOString()
      })
    });
    const task = await createRes.json();

    const snoozeRes = await fetch(`${server.baseUrl}/api/tasks/${task.id}/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 10 })
    });
    assert.equal(snoozeRes.status, 200);
    const snoozed = await snoozeRes.json();
    const delta = new Date(snoozed.nextReminderAt).getTime() - Date.now();
    assert.ok(delta > 9 * 60 * 1000);
    assert.ok(delta <= 10 * 60 * 1000);
    assert.equal(snoozed.completed, false);
  } finally {
    await server.close();
  }
});

test('scheduler repeats unfinished reminders without duplicating the same interval', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'motivateme-'));
  const store = new TaskStore(path.join(dir, 'tasks.json'));
  try {
    const task = await store.create({
      title: 'Repeat reminder task',
      reminderAt: new Date(Date.now() + 60000).toISOString(),
      reminderOffsetMinutes: 5,
      repeatIntervalMinutes: 5,
      quotePreference: { mode: 'custom', customMessage: 'Keep going.' }
    });
    await store.update(task.id, { nextReminderAt: new Date(Date.now() - 1000).toISOString() });

    const scheduler = new ReminderScheduler(store);
    await scheduler.checkDueTasks();

    const [updated] = await store.readAll();
    assert.equal(updated.reminderCount, 1);
    assert.equal(updated.lastReminder.text, 'Keep going.');
    assert.ok(new Date(updated.nextReminderAt).getTime() > Date.now());

    await scheduler.checkDueTasks();
    const [afterDuplicateCheck] = await store.readAll();
    assert.equal(afterDuplicateCheck.reminderCount, 1);

    const completed = await store.update(task.id, { completed: true });
    assert.equal(completed.nextReminderAt, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('generates local quotes and exposes quote options', async () => {
  assert.ok(localQuotes.length >= 40);
  assert.ok(localQuotes.length <= 50);
  assert.ok(localQuotes.some((quote) => quote.type === 'motivation'));
  assert.ok(localQuotes.some((quote) => quote.type === 'wisdom'));

  const server = await withServer();
  try {
    const healthRes = await fetch(`${server.baseUrl}/api/health`);
    const health = await healthRes.json();
    assert.deepEqual(health.quoteOptions.modes, ['motivation', 'wisdom', 'random', 'custom']);
    assert.equal(health.quoteOptions.quoteCount, localQuotes.length);

    const quoteRes = await fetch(`${server.baseUrl}/api/content/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Write history outline',
        quotePreference: { mode: 'custom', customMessage: 'Take the first clean step.' }
      })
    });
    const quote = await quoteRes.json();
    assert.equal(quote.text, 'Take the first clean step.');
    assert.equal(quote.author, 'You');
    assert.equal(quote.type, 'custom');
  } finally {
    await server.close();
  }
});

test('rejects invalid task input', async () => {
  const server = await withServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '' })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.errors.length >= 1);

    const invalidTimingRes = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Invalid timing task',
        reminderAt: new Date(Date.now() + 60000).toISOString(),
        reminderOffsetMinutes: 1441,
        repeatIntervalMinutes: -1
      })
    });
    assert.equal(invalidTimingRes.status, 400);
  } finally {
    await server.close();
  }
});
