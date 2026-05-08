import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/index.js';
import { TaskStore } from '../src/storage.js';
import { ReminderScheduler } from '../src/reminderScheduler.js';
import { localQuotes } from '../src/content/quotes.js';
import { generateNudge, nudgeStageForCount, nudgeTones } from '../src/content/nudges.js';

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

test('defaults nudge tone to supportive and accepts valid tones', async () => {
  const server = await withServer();
  try {
    const defaultRes = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Default tone task',
        reminderAt: new Date(Date.now() + 60000).toISOString()
      })
    });
    const defaultTask = await defaultRes.json();
    assert.equal(defaultTask.nudgeTone, 'supportive');

    for (const tone of nudgeTones) {
      const res = await fetch(`${server.baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${tone} tone task`,
          reminderAt: new Date(Date.now() + 60000).toISOString(),
          nudgeTone: tone
        })
      });
      assert.equal(res.status, 201);
      const task = await res.json();
      assert.equal(task.nudgeTone, tone);
    }
  } finally {
    await server.close();
  }
});

test('new tasks receive a smaller order than existing active tasks so they sort first', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'motivateme-'));
  const store = new TaskStore(path.join(dir, 'tasks.json'));
  try {
    const first = await store.create({
      title: 'First',
      reminderAt: new Date(Date.now() + 60000).toISOString()
    });
    const second = await store.create({
      title: 'Second',
      reminderAt: new Date(Date.now() + 120000).toISOString()
    });
    assert.ok(Number.isFinite(first.order));
    assert.ok(Number.isFinite(second.order));
    assert.ok(second.order < first.order);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('PUT /api/tasks/order persists task order across reads', async () => {
  const server = await withServer();
  try {
    const reminderAt = new Date(Date.now() + 60000).toISOString();
    const titles = ['Alpha', 'Beta', 'Gamma'];
    const created = [];
    for (const title of titles) {
      const res = await fetch(`${server.baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, reminderAt })
      });
      created.push(await res.json());
    }
    const desired = [created[1].id, created[2].id, created[0].id];

    const reorderRes = await fetch(`${server.baseUrl}/api/tasks/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: desired })
    });
    assert.equal(reorderRes.status, 200);

    const listRes = await fetch(`${server.baseUrl}/api/tasks`);
    const tasks = await listRes.json();
    const sorted = [...tasks].sort((a, b) => a.order - b.order).map((task) => task.id);
    assert.deepEqual(sorted, desired);

    const refetchRes = await fetch(`${server.baseUrl}/api/tasks`);
    const refetched = await refetchRes.json();
    const sortedAgain = [...refetched].sort((a, b) => a.order - b.order).map((task) => task.id);
    assert.deepEqual(sortedAgain, desired);
  } finally {
    await server.close();
  }
});

test('PUT /api/tasks/order rejects unknown task ids', async () => {
  const server = await withServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/tasks/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ['00000000-0000-0000-0000-000000000000'] })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  } finally {
    await server.close();
  }
});

test('PATCH updates editable fields and recalculates nextReminderAt when timing changes', async () => {
  const server = await withServer();
  try {
    const initialReminder = new Date(Date.now() + 600000).toISOString();
    const createRes = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Original title',
        description: 'Initial notes',
        reminderAt: initialReminder,
        reminderOffsetMinutes: 5,
        repeatIntervalMinutes: 10,
        quotePreference: { mode: 'motivation' },
        nudgeTone: 'supportive'
      })
    });
    const created = await createRes.json();

    const newReminder = new Date(Date.now() + 1800000).toISOString();
    const patchRes = await fetch(`${server.baseUrl}/api/tasks/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Edited title',
        description: 'Updated notes',
        reminderAt: newReminder,
        reminderOffsetMinutes: 20,
        repeatIntervalMinutes: 30,
        quotePreference: { mode: 'custom', customMessage: 'One steady step.' },
        nudgeTone: 'tough'
      })
    });
    assert.equal(patchRes.status, 200);
    const updated = await patchRes.json();
    assert.equal(updated.id, created.id);
    assert.equal(updated.title, 'Edited title');
    assert.equal(updated.description, 'Updated notes');
    assert.equal(updated.reminderAt, newReminder);
    assert.equal(updated.reminderOffsetMinutes, 20);
    assert.equal(updated.repeatIntervalMinutes, 30);
    assert.equal(updated.quotePreference.mode, 'custom');
    assert.equal(updated.quotePreference.customMessage, 'One steady step.');
    assert.equal(updated.nudgeTone, 'tough');
    assert.equal(
      new Date(updated.nextReminderAt).getTime(),
      new Date(newReminder).getTime() - 20 * 60 * 1000
    );
    assert.equal(updated.reminderCount, 0);
    assert.equal(updated.remindedAt, null);
    assert.equal(updated.lastReminder, null);

    const listRes = await fetch(`${server.baseUrl}/api/tasks`);
    const tasks = await listRes.json();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, 'Edited title');
    assert.equal(tasks[0].nudgeTone, 'tough');
  } finally {
    await server.close();
  }
});

test('PATCH does not reset reminder progress when reminderAt is resent unchanged', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'motivateme-'));
  const store = new TaskStore(path.join(dir, 'tasks.json'));
  const scheduler = { on() {}, start() {}, stop() {} };
  const app = createApp({ store, scheduler });
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const created = await store.create({
      title: 'Edit-only-tone task',
      reminderAt: new Date(Date.now() + 600000).toISOString(),
      reminderOffsetMinutes: 5,
      repeatIntervalMinutes: 10,
      quotePreference: { mode: 'motivation' },
      nudgeTone: 'supportive'
    });
    await store.update(created.id, {
      reminderCount: 2,
      remindedAt: new Date().toISOString(),
      lastReminder: { text: 'previous', author: 'MotivateMe', type: 'micro-start', source: 'nudge' }
    });

    const patchRes = await fetch(`${baseUrl}/api/tasks/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: created.title,
        description: created.description,
        reminderAt: created.reminderAt,
        reminderOffsetMinutes: created.reminderOffsetMinutes,
        repeatIntervalMinutes: created.repeatIntervalMinutes,
        quotePreference: created.quotePreference,
        nudgeTone: 'tough'
      })
    });
    const updated = await patchRes.json();
    assert.equal(updated.nudgeTone, 'tough');
    assert.equal(updated.reminderCount, 2);
    assert.ok(updated.remindedAt);
    assert.equal(updated.lastReminder.text, 'previous');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('PATCH preserves nudgeTone when only quotePreference changes', async () => {
  const server = await withServer();
  try {
    const createRes = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Tone preservation task',
        reminderAt: new Date(Date.now() + 600000).toISOString(),
        nudgeTone: 'direct'
      })
    });
    const created = await createRes.json();

    const patchRes = await fetch(`${server.baseUrl}/api/tasks/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quotePreference: { mode: 'wisdom' } })
    });
    const updated = await patchRes.json();
    assert.equal(updated.nudgeTone, 'direct');
    assert.equal(updated.quotePreference.mode, 'wisdom');
    assert.equal(updated.reminderAt, created.reminderAt);
    assert.equal(updated.nextReminderAt, created.nextReminderAt);
  } finally {
    await server.close();
  }
});

test('accepts repeatIntervalMinutes: 1 as a built-in option', async () => {
  const server = await withServer();
  try {
    const createRes = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'One-minute repeat task',
        reminderAt: new Date(Date.now() + 600000).toISOString(),
        repeatIntervalMinutes: 1
      })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.repeatIntervalMinutes, 1);

    const listRes = await fetch(`${server.baseUrl}/api/tasks`);
    const tasks = await listRes.json();
    assert.equal(tasks[0].repeatIntervalMinutes, 1);

    const patchRes = await fetch(`${server.baseUrl}/api/tasks/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repeatIntervalMinutes: 1 })
    });
    const patched = await patchRes.json();
    assert.equal(patched.repeatIntervalMinutes, 1);
  } finally {
    await server.close();
  }
});

test('persists nudgeTone "tough" through create, list, and update', async () => {
  const server = await withServer();
  try {
    const createRes = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Finish problem set',
        reminderAt: new Date(Date.now() + 600000).toISOString(),
        nudgeTone: 'tough'
      })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.nudgeTone, 'tough');

    const listRes = await fetch(`${server.baseUrl}/api/tasks`);
    const tasks = await listRes.json();
    const listed = tasks.find((task) => task.id === created.id);
    assert.equal(listed.nudgeTone, 'tough');

    const patchRes = await fetch(`${server.baseUrl}/api/tasks/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Updated note' })
    });
    const patched = await patchRes.json();
    assert.equal(patched.nudgeTone, 'tough');
  } finally {
    await server.close();
  }
});

test('rejects invalid nudge tones', async () => {
  const server = await withServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Bad tone task',
        reminderAt: new Date(Date.now() + 60000).toISOString(),
        nudgeTone: 'savage'
      })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.errors.some((message) => message.toLowerCase().includes('nudge tone')));
  } finally {
    await server.close();
  }
});

test('progressive nudge generator advances stages and respects tone', () => {
  assert.equal(nudgeStageForCount(0), 'initial');
  assert.equal(nudgeStageForCount(1), 'micro-start');
  assert.equal(nudgeStageForCount(2), 'identity');
  assert.equal(nudgeStageForCount(7), 'identity');

  const microSupportive = generateNudge({ stage: 'micro-start', tone: 'supportive', title: 'biology lab' });
  assert.equal(microSupportive.stage, 'micro-start');
  assert.equal(microSupportive.tone, 'supportive');
  assert.equal(microSupportive.source, 'nudge');
  assert.equal(microSupportive.sourceLabel, 'Micro-start nudge');
  assert.equal(microSupportive.toneLabel, 'Supportive nudge');

  const identityTough = generateNudge({ stage: 'identity', tone: 'tough', title: 'history outline' });
  assert.equal(identityTough.stage, 'identity');
  assert.equal(identityTough.tone, 'tough');
  assert.equal(identityTough.sourceLabel, 'Identity nudge');
  assert.equal(identityTough.toneLabel, 'Tough nudge');
  assert.ok(identityTough.text.length > 0);

  const fallback = generateNudge({ stage: 'micro-start', tone: 'savage', title: '' });
  assert.equal(fallback.tone, 'supportive');
  assert.ok(fallback.text.includes('this task'));
});

test('scheduler progresses through quote, micro-start, and identity stages', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'motivateme-'));
  const store = new TaskStore(path.join(dir, 'tasks.json'));
  try {
    const task = await store.create({
      title: 'Write history outline',
      reminderAt: new Date(Date.now() + 60000).toISOString(),
      reminderOffsetMinutes: 5,
      repeatIntervalMinutes: 5,
      quotePreference: { mode: 'motivation' },
      nudgeTone: 'direct'
    });

    const scheduler = new ReminderScheduler(store);

    await store.update(task.id, { nextReminderAt: new Date(Date.now() - 1000).toISOString() });
    await scheduler.checkDueTasks();
    let [updated] = await store.readAll();
    assert.equal(updated.reminderCount, 1);
    assert.equal(updated.lastReminder.stage, 'initial');
    assert.equal(updated.lastReminder.tone, 'direct');
    assert.equal(updated.lastReminder.source, 'local');
    assert.equal(updated.lastReminder.sourceLabel, 'Curated local quote');

    await store.update(task.id, { nextReminderAt: new Date(Date.now() - 1000).toISOString() });
    await scheduler.checkDueTasks();
    [updated] = await store.readAll();
    assert.equal(updated.reminderCount, 2);
    assert.equal(updated.lastReminder.stage, 'micro-start');
    assert.equal(updated.lastReminder.tone, 'direct');
    assert.equal(updated.lastReminder.source, 'nudge');
    assert.equal(updated.lastReminder.sourceLabel, 'Micro-start nudge');
    assert.ok(updated.lastReminder.text.includes('Write history outline'));

    await store.update(task.id, { nextReminderAt: new Date(Date.now() - 1000).toISOString() });
    await scheduler.checkDueTasks();
    [updated] = await store.readAll();
    assert.equal(updated.reminderCount, 3);
    assert.equal(updated.lastReminder.stage, 'identity');
    assert.equal(updated.lastReminder.tone, 'direct');
    assert.equal(updated.lastReminder.sourceLabel, 'Identity nudge');

    await store.update(task.id, { nextReminderAt: new Date(Date.now() - 1000).toISOString() });
    await scheduler.checkDueTasks();
    [updated] = await store.readAll();
    assert.equal(updated.reminderCount, 4);
    assert.equal(updated.lastReminder.stage, 'identity');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('first reminder for custom message preserves the user message', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'motivateme-'));
  const store = new TaskStore(path.join(dir, 'tasks.json'));
  try {
    const task = await store.create({
      title: 'Read chapter 4',
      reminderAt: new Date(Date.now() + 60000).toISOString(),
      reminderOffsetMinutes: 5,
      repeatIntervalMinutes: 5,
      quotePreference: { mode: 'custom', customMessage: 'Two pages, then a break.' },
      nudgeTone: 'tough'
    });
    await store.update(task.id, { nextReminderAt: new Date(Date.now() - 1000).toISOString() });

    const scheduler = new ReminderScheduler(store);
    await scheduler.checkDueTasks();
    let [updated] = await store.readAll();
    assert.equal(updated.lastReminder.text, 'Two pages, then a break.');
    assert.equal(updated.lastReminder.stage, 'initial');
    assert.equal(updated.lastReminder.source, 'custom');

    await store.update(task.id, { nextReminderAt: new Date(Date.now() - 1000).toISOString() });
    await scheduler.checkDueTasks();
    [updated] = await store.readAll();
    assert.equal(updated.lastReminder.stage, 'micro-start');
    assert.equal(updated.lastReminder.tone, 'tough');
    assert.equal(updated.lastReminder.source, 'nudge');
    assert.notEqual(updated.lastReminder.text, 'Two pages, then a break.');
  } finally {
    await rm(dir, { recursive: true, force: true });
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
