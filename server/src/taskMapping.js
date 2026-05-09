// Single source of truth for task field naming across the JS layer
// (camelCase) and the Postgres layer (snake_case). Add a row here whenever a
// new task field is introduced and both sides will pick it up.
//
// Fields whose JS and DB names already match (id, user_id, title, description,
// completed, order) appear unchanged on both sides — listing them here keeps
// the projection explicit so unknown fields never leak across the boundary.

const FIELD_MAP = [
  { js: 'id',                      db: 'id' },
  { js: 'user_id',                 db: 'user_id' },
  { js: 'title',                   db: 'title' },
  { js: 'description',             db: 'description' },
  { js: 'reminderAt',              db: 'reminder_at' },
  { js: 'reminderOffsetMinutes',   db: 'reminder_offset_minutes' },
  { js: 'repeatIntervalMinutes',   db: 'repeat_interval_minutes' },
  { js: 'nextReminderAt',          db: 'next_reminder_at' },
  { js: 'reminderCount',           db: 'reminder_count' },
  { js: 'quotePreference',         db: 'quote_preference' },
  { js: 'nudgeTone',               db: 'nudge_tone' },
  { js: 'lastReminder',            db: 'last_reminder' },
  { js: 'completed',               db: 'completed' },
  { js: 'remindedAt',              db: 'reminded_at' },
  { js: 'order',                   db: 'order' },
  { js: 'createdAt',               db: 'created_at' },
  { js: 'updatedAt',               db: 'updated_at' }
];

const JS_TO_DB = Object.fromEntries(FIELD_MAP.map(({ js, db }) => [js, db]));
const DB_TO_JS = Object.fromEntries(FIELD_MAP.map(({ js, db }) => [db, js]));

export const TASK_DB_COLUMNS = FIELD_MAP.map(({ db }) => db);

export function toDbRow(task) {
  if (!task || typeof task !== 'object') return {};
  const row = {};
  for (const [jsKey, value] of Object.entries(task)) {
    const dbKey = JS_TO_DB[jsKey];
    if (dbKey !== undefined) {
      row[dbKey] = value;
    }
  }
  return row;
}

export function fromDbRow(row) {
  if (!row || typeof row !== 'object') return null;
  const task = {};
  for (const [dbKey, value] of Object.entries(row)) {
    const jsKey = DB_TO_JS[dbKey];
    if (jsKey !== undefined) {
      task[jsKey] = value;
    }
  }
  return task;
}
