import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlannerPrompt,
  parseImportJson,
  sanitizeTask,
  validateImport,
  MAX_IMPORT_TASKS
} from '../../client/src/projectPlannerImport.js';

test('buildPlannerPrompt embeds the current local date, time, and timezone', () => {
  const fixed = new Date('2026-05-09T14:30:00Z');
  const prompt = buildPlannerPrompt(
    {
      projectName: 'Thesis',
      projectDeadline: '2026-06-01',
      workWindows: 'Weeknights 7-10pm',
      taskLength: '30 min',
      defaultTone: 'direct',
      defaultQuoteMode: 'wisdom'
    },
    fixed
  );
  assert.match(prompt, /Current local date: \d{4}-\d{2}-\d{2}/);
  assert.match(prompt, /Current local time: \d{2}:\d{2}:\d{2}/);
  assert.match(prompt, /Local timezone: .+\(UTC[+-]\d{2}:\d{2}\)/);
  assert.match(prompt, /Name: Thesis/);
  assert.match(prompt, /Deadline: 2026-06-01/);
  assert.match(prompt, /Default nudge tone: direct/);
  assert.match(prompt, /Default quote style: wisdom/);
  assert.match(prompt, /Return ONLY a valid JSON array\./);
  assert.match(prompt, /YYYY-MM-DDTHH:mm:ss/);
});

test('buildPlannerPrompt falls back to safe defaults for unknown tones/modes', () => {
  const prompt = buildPlannerPrompt({
    projectName: '',
    defaultTone: 'savage',
    defaultQuoteMode: 'haiku'
  });
  assert.match(prompt, /Default nudge tone: supportive/);
  assert.match(prompt, /Default quote style: motivation/);
  assert.match(prompt, /Name: Untitled project/);
});

test('parseImportJson rejects empty, non-JSON, non-array, and overfull payloads', () => {
  assert.equal(parseImportJson('').ok, false);
  assert.match(parseImportJson('not json at all').error, /Invalid JSON/);
  assert.match(parseImportJson('{"a":1}').error, /array/);
  assert.match(parseImportJson('[]').error, /empty/);
  const oversized = JSON.stringify(
    Array.from({ length: MAX_IMPORT_TASKS + 1 }, () => ({
      title: 'x',
      reminderAt: new Date().toISOString()
    }))
  );
  assert.match(parseImportJson(oversized).error, /Too many tasks/);
});

test('sanitizeTask requires title and reminderAt, applies defaults, ignores unknown fields', () => {
  const missingBoth = sanitizeTask({}, 0);
  assert.deepEqual(missingBoth.task, null);
  assert.equal(missingBoth.errors.length, 2);

  const missingReminder = sanitizeTask({ title: 'x' }, 1);
  assert.match(missingReminder.errors.join(' '), /reminderAt/);

  const badDate = sanitizeTask({ title: 'x', reminderAt: 'not-a-date' }, 2);
  assert.match(badDate.errors.join(' '), /invalid reminderAt/);

  const ok = sanitizeTask(
    {
      title: '  Outline thesis  ',
      description: '  notes  ',
      reminderAt: '2026-06-01T15:30:00',
      __proto__: 'evil',
      somethingExtra: 42,
      reminderOffsetMinutes: '15',
      repeatIntervalMinutes: 'invalid',
      quotePreference: { mode: 'wisdom', customMessage: '   ignored when not custom   ' },
      nudgeTone: 'tough'
    },
    3
  );
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.task.title, 'Outline thesis');
  assert.equal(ok.task.description, 'notes');
  // reminderAt normalized to ISO with Z (UTC).
  assert.ok(/Z$/.test(ok.task.reminderAt));
  assert.equal(ok.task.reminderOffsetMinutes, 15);
  assert.equal(ok.task.repeatIntervalMinutes, 1); // fallback
  assert.deepEqual(ok.task.quotePreference, { mode: 'wisdom', customMessage: '' });
  assert.equal(ok.task.nudgeTone, 'tough');
  assert.ok(!('somethingExtra' in ok.task));
});

test('sanitizeTask preserves a custom message only when mode is custom', () => {
  const result = sanitizeTask(
    {
      title: 'x',
      reminderAt: '2026-06-01T15:30:00',
      quotePreference: { mode: 'custom', customMessage: '  go go go  ' }
    },
    0
  );
  assert.equal(result.task.quotePreference.mode, 'custom');
  assert.equal(result.task.quotePreference.customMessage, 'go go go');
});

test('sanitizeTask rejects invalid tone with the safe default', () => {
  const result = sanitizeTask(
    {
      title: 'x',
      reminderAt: '2026-06-01T15:30:00',
      nudgeTone: 'aggressive'
    },
    0
  );
  assert.equal(result.task.nudgeTone, 'supportive');
});

test('validateImport returns sanitized tasks on success and collected errors on failure', () => {
  const goodPayload = JSON.stringify([
    {
      title: 'A',
      reminderAt: '2026-06-01T10:00:00',
      reminderOffsetMinutes: 0,
      repeatIntervalMinutes: 5,
      quotePreference: { mode: 'motivation' },
      nudgeTone: 'direct'
    },
    {
      title: 'B',
      reminderAt: '2026-06-01T11:00:00'
    }
  ]);
  const okResult = validateImport(goodPayload);
  assert.equal(okResult.ok, true);
  assert.equal(okResult.tasks.length, 2);
  assert.equal(okResult.tasks[1].repeatIntervalMinutes, 1); // default

  const badPayload = JSON.stringify([
    { title: 'A', reminderAt: '2026-06-01T10:00:00' },
    { description: 'no title or reminder' },
    { title: 'C', reminderAt: 'nope' }
  ]);
  const badResult = validateImport(badPayload);
  assert.equal(badResult.ok, false);
  assert.equal(badResult.tasks.length, 0);
  assert.match(badResult.error, /Task 2/);
  assert.match(badResult.error, /Task 3/);
});
