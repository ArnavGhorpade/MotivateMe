// Project Planner Import helpers.
//
// These are pure functions: no React, no DOM, no browser-only globals beyond
// Date / Intl which exist in Node too. They are imported by the React modal
// and exercised directly by server/test/projectPlannerImport.test.js so the
// validation logic has fast, deterministic coverage.

export const MAX_IMPORT_TASKS = 25;
export const VALID_NUDGE_TONES = ['supportive', 'direct', 'tough'];
export const VALID_QUOTE_MODES = ['motivation', 'wisdom', 'random', 'custom'];
export const MAX_CUSTOM_MINUTES = 1440;

export const DEFAULT_REMINDER_OFFSET_MINUTES = 0;
export const DEFAULT_REPEAT_INTERVAL_MINUTES = 1;
export const DEFAULT_NUDGE_TONE = 'supportive';
export const DEFAULT_QUOTE_MODE = 'motivation';

function formatTzOffset(date) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

function localDateTimeString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function buildPlannerPrompt(input, now = new Date()) {
  const projectName = (input?.projectName || '').trim() || 'Untitled project';
  const projectDeadline = (input?.projectDeadline || '').trim() || 'Not specified';
  const workWindows = (input?.workWindows || '').trim() || 'Not specified';
  const taskLength = (input?.taskLength || '').trim() || 'Not specified';
  const defaultTone = VALID_NUDGE_TONES.includes(input?.defaultTone)
    ? input.defaultTone
    : DEFAULT_NUDGE_TONE;
  const defaultQuoteMode = VALID_QUOTE_MODES.includes(input?.defaultQuoteMode)
    ? input.defaultQuoteMode
    : DEFAULT_QUOTE_MODE;

  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(now.getDate()).padStart(2, '0')}`;
  const localTime = `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes()
  ).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  let timeZone = 'UTC';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // ignore — fall back to UTC
  }
  const tzOffset = formatTzOffset(now);
  const example = [
    {
      title: 'Task title',
      description: 'What to do',
      reminderAt: localDateTimeString(now),
      reminderOffsetMinutes: 0,
      repeatIntervalMinutes: 1,
      quotePreference: { mode: defaultQuoteMode },
      nudgeTone: defaultTone
    }
  ];

  return [
    "You are MotivateMe's project planner.",
    '',
    'CURRENT LOCAL CONTEXT (use this exactly — do not assume today\'s date):',
    `- Current local date: ${localDate}`,
    `- Current local time: ${localTime}`,
    `- Local timezone: ${timeZone} (UTC${tzOffset})`,
    '',
    'Use the current local time above as the scheduling reference point. Return reminderAt values in local time using the format YYYY-MM-DDTHH:mm:ss (no timezone suffix).',
    '',
    'PROJECT:',
    `- Name: ${projectName}`,
    `- Deadline: ${projectDeadline}`,
    `- Available work windows: ${workWindows}`,
    `- Preferred task length: ${taskLength}`,
    `- Default nudge tone: ${defaultTone}`,
    `- Default quote style: ${defaultQuoteMode}`,
    '',
    'INSTRUCTIONS:',
    '- Break the project into realistic, small, concrete tasks.',
    '- Avoid vague tasks like "work on project" — each task must name a specific deliverable or action.',
    "- Use the user's available work windows. Do not schedule tasks outside those windows.",
    '- Every reminderAt must be after the current local time and before the deadline.',
    '- Match the preferred task length when sizing each step.',
    '- Use the default nudge tone and quote style unless a specific task clearly benefits from a different tone.',
    `- reminderOffsetMinutes defaults to ${DEFAULT_REMINDER_OFFSET_MINUTES}.`,
    `- repeatIntervalMinutes defaults to ${DEFAULT_REPEAT_INTERVAL_MINUTES}.`,
    `- Return at most ${MAX_IMPORT_TASKS} tasks.`,
    '',
    'OUTPUT FORMAT:',
    'Return ONLY a valid JSON array. No markdown. No code fences. No commentary.',
    'Each element MUST match this exact shape:',
    '',
    JSON.stringify(example, null, 2)
  ].join('\n');
}

export function parseImportJson(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) {
    return { ok: false, error: 'Paste the AI JSON output before previewing.' };
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err.message}` };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'Expected a JSON array of tasks.' };
  }
  if (parsed.length === 0) {
    return { ok: false, error: 'The JSON array is empty.' };
  }
  if (parsed.length > MAX_IMPORT_TASKS) {
    return {
      ok: false,
      error: `Too many tasks (${parsed.length}). The maximum is ${MAX_IMPORT_TASKS}.`
    };
  }
  return { ok: true, raw: parsed };
}

function sanitizeMinutes(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0 && n <= MAX_CUSTOM_MINUTES) {
    return Math.round(n);
  }
  return fallback;
}

function sanitizeQuotePreference(raw) {
  const mode = VALID_QUOTE_MODES.includes(raw?.mode) ? raw.mode : DEFAULT_QUOTE_MODE;
  const customMessage =
    mode === 'custom' && typeof raw?.customMessage === 'string'
      ? raw.customMessage.trim()
      : '';
  return { mode, customMessage };
}

export function sanitizeTask(raw, index = 0) {
  const errors = [];
  const label = `Task ${index + 1}`;

  const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
  if (!title) errors.push(`${label}: missing title.`);
  if (title.length > 200) errors.push(`${label}: title is too long (max 200 chars).`);

  let reminderAtIso = null;
  const reminderAtRaw = raw?.reminderAt;
  if (typeof reminderAtRaw !== 'string' || !reminderAtRaw.trim()) {
    errors.push(`${label}: missing reminderAt.`);
  } else {
    const parsed = new Date(reminderAtRaw);
    if (!Number.isFinite(parsed.getTime())) {
      errors.push(`${label}: invalid reminderAt "${reminderAtRaw}".`);
    } else {
      reminderAtIso = parsed.toISOString();
    }
  }

  if (errors.length) {
    return { errors, task: null };
  }

  const description =
    typeof raw?.description === 'string' ? raw.description.trim() : '';

  const reminderOffsetMinutes = sanitizeMinutes(
    raw?.reminderOffsetMinutes,
    DEFAULT_REMINDER_OFFSET_MINUTES
  );
  const repeatIntervalMinutes = sanitizeMinutes(
    raw?.repeatIntervalMinutes,
    DEFAULT_REPEAT_INTERVAL_MINUTES
  );
  const quotePreference = sanitizeQuotePreference(raw?.quotePreference);
  const nudgeTone = VALID_NUDGE_TONES.includes(raw?.nudgeTone)
    ? raw.nudgeTone
    : DEFAULT_NUDGE_TONE;

  return {
    errors: [],
    task: {
      title,
      description,
      reminderAt: reminderAtIso,
      reminderOffsetMinutes,
      repeatIntervalMinutes,
      quotePreference,
      nudgeTone
    }
  };
}

export function validateImport(text) {
  const parsed = parseImportJson(text);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, tasks: [] };
  }
  const tasks = [];
  const errors = [];
  parsed.raw.forEach((raw, index) => {
    const result = sanitizeTask(raw, index);
    if (result.errors.length) {
      errors.push(...result.errors);
    } else {
      tasks.push(result.task);
    }
  });
  if (errors.length) {
    return { ok: false, error: errors.join('\n'), tasks: [] };
  }
  return { ok: true, error: null, tasks };
}
