import test from 'node:test';
import assert from 'node:assert/strict';
import { toDbRow, fromDbRow, TASK_DB_COLUMNS } from '../src/taskMapping.js';

test('taskMapping exposes every persisted column', () => {
  // Sanity check: the schema.sql columns are reflected here. If a new column
  // is added, this list and the schema must move together.
  assert.deepEqual(
    [...TASK_DB_COLUMNS].sort(),
    [
      'completed',
      'created_at',
      'description',
      'id',
      'last_reminder',
      'next_reminder_at',
      'nudge_tone',
      'order',
      'reminded_at',
      'reminder_at',
      'reminder_count',
      'reminder_offset_minutes',
      'repeat_interval_minutes',
      'quote_preference',
      'title',
      'updated_at',
      'user_id'
    ].sort()
  );
});

test('toDbRow renames camelCase fields and drops unknown keys', () => {
  const task = {
    id: 'a',
    user_id: 'u',
    title: 'T',
    description: 'd',
    reminderAt: '2026-01-01T00:00:00.000Z',
    reminderOffsetMinutes: 5,
    repeatIntervalMinutes: 10,
    nextReminderAt: '2026-01-01T00:05:00.000Z',
    reminderCount: 2,
    quotePreference: { mode: 'wisdom', customMessage: '' },
    nudgeTone: 'tough',
    lastReminder: { text: 'go', author: 'A', type: 'micro-start', source: 'nudge' },
    completed: false,
    remindedAt: null,
    order: -3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    junkField: 'should not appear'
  };

  const row = toDbRow(task);
  assert.equal(row.reminder_at, task.reminderAt);
  assert.equal(row.reminder_offset_minutes, 5);
  assert.equal(row.repeat_interval_minutes, 10);
  assert.equal(row.next_reminder_at, task.nextReminderAt);
  assert.equal(row.reminder_count, 2);
  assert.deepEqual(row.quote_preference, task.quotePreference);
  assert.equal(row.nudge_tone, 'tough');
  assert.deepEqual(row.last_reminder, task.lastReminder);
  assert.equal(row.reminded_at, null);
  assert.equal(row.order, -3);
  assert.equal(row.created_at, task.createdAt);
  assert.equal(row.updated_at, task.updatedAt);
  assert.equal(row.user_id, 'u');
  assert.equal(row.title, 'T');
  assert.equal(row.completed, false);
  assert.ok(!('junkField' in row));
  assert.ok(!('junk_field' in row));
});

test('fromDbRow renames snake_case fields and drops unknown keys', () => {
  const row = {
    id: 'a',
    user_id: 'u',
    title: 'T',
    description: 'd',
    reminder_at: '2026-01-01T00:00:00.000Z',
    reminder_offset_minutes: 5,
    repeat_interval_minutes: 10,
    next_reminder_at: '2026-01-01T00:05:00.000Z',
    reminder_count: 2,
    quote_preference: { mode: 'motivation', customMessage: '' },
    nudge_tone: 'direct',
    last_reminder: null,
    completed: true,
    reminded_at: '2026-01-01T00:00:30.000Z',
    order: 4,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    surprise_column: 'ignored'
  };

  const task = fromDbRow(row);
  assert.equal(task.reminderAt, row.reminder_at);
  assert.equal(task.reminderOffsetMinutes, 5);
  assert.equal(task.repeatIntervalMinutes, 10);
  assert.equal(task.nextReminderAt, row.next_reminder_at);
  assert.equal(task.reminderCount, 2);
  assert.deepEqual(task.quotePreference, row.quote_preference);
  assert.equal(task.nudgeTone, 'direct');
  assert.equal(task.lastReminder, null);
  assert.equal(task.completed, true);
  assert.equal(task.remindedAt, row.reminded_at);
  assert.equal(task.order, 4);
  assert.equal(task.createdAt, row.created_at);
  assert.equal(task.updatedAt, row.updated_at);
  assert.equal(task.user_id, 'u');
  assert.ok(!('surprise_column' in task));
  assert.ok(!('surpriseColumn' in task));
});

test('toDbRow then fromDbRow round-trips every persisted field', () => {
  const original = {
    id: 'task-id',
    user_id: 'user-id',
    title: 'Round trip',
    description: 'desc',
    reminderAt: '2026-05-08T19:00:00.000Z',
    reminderOffsetMinutes: 20,
    repeatIntervalMinutes: 5,
    nextReminderAt: '2026-05-08T18:40:00.000Z',
    reminderCount: 3,
    quotePreference: { mode: 'custom', customMessage: 'go' },
    nudgeTone: 'supportive',
    lastReminder: {
      text: 'You said this mattered.',
      author: 'MotivateMe',
      type: 'identity',
      source: 'nudge',
      tone: 'tough',
      stage: 'identity',
      sourceLabel: 'Identity nudge',
      toneLabel: 'Tough nudge'
    },
    completed: false,
    remindedAt: '2026-05-08T18:42:00.000Z',
    order: 0,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z'
  };

  assert.deepEqual(fromDbRow(toDbRow(original)), original);
});

test('validateBackendConfig: json mode does not require Supabase env vars', async () => {
  const previous = {
    backend: process.env.DATA_BACKEND,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  process.env.DATA_BACKEND = 'json';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    // Re-import via cache-busting query so the module reads the new env values.
    const mod = await import(`../src/config.js?nocache=${Date.now()}`);
    assert.doesNotThrow(() => mod.validateBackendConfig());
  } finally {
    if (previous.backend === undefined) delete process.env.DATA_BACKEND;
    else process.env.DATA_BACKEND = previous.backend;
    if (previous.url !== undefined) process.env.SUPABASE_URL = previous.url;
    if (previous.key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});

test('validateBackendConfig: supabase mode without env vars fails clearly', async () => {
  const previous = {
    backend: process.env.DATA_BACKEND,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  process.env.DATA_BACKEND = 'supabase';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const mod = await import(`../src/config.js?nocache=${Date.now()}`);
    assert.throws(
      () => mod.validateBackendConfig(),
      /SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY/
    );
  } finally {
    if (previous.backend === undefined) delete process.env.DATA_BACKEND;
    else process.env.DATA_BACKEND = previous.backend;
    if (previous.url !== undefined) process.env.SUPABASE_URL = previous.url;
    if (previous.key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});

test('validateBackendConfig: unknown DATA_BACKEND value rejects', async () => {
  const previous = process.env.DATA_BACKEND;
  process.env.DATA_BACKEND = 'mongo';
  try {
    const mod = await import(`../src/config.js?nocache=${Date.now()}`);
    assert.throws(() => mod.validateBackendConfig(), /Unknown DATA_BACKEND/);
  } finally {
    if (previous === undefined) delete process.env.DATA_BACKEND;
    else process.env.DATA_BACKEND = previous;
  }
});
