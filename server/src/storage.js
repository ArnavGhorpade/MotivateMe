import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.join(__dirname, 'data', 'tasks.json');
const quoteModes = ['motivation', 'wisdom', 'random', 'custom'];
const nudgeTones = ['supportive', 'direct', 'tough'];
const defaultNudgeTone = 'supportive';
const reminderOffsets = [0, 5, 10, 20];
const repeatIntervals = [0, 1, 5, 10, 20];
const snoozeIntervals = [5, 10, 20];
const maxCustomMinutes = 1440;

export { nudgeTones, defaultNudgeTone };

function normalizeNudgeTone(value) {
  return nudgeTones.includes(value) ? value : defaultNudgeTone;
}

function normalizeMinutes(value, allowed, fallback = 0) {
  const minutes = Number(value);
  return allowed.includes(minutes) ? minutes : fallback;
}

function normalizeCustomMinutes(value, allowed, fallback = 0) {
  const minutes = Number(value);
  if (allowed.includes(minutes)) return minutes;
  if (Number.isFinite(minutes) && minutes > 0 && minutes <= maxCustomMinutes) {
    return Math.round(minutes);
  }
  return fallback;
}

function normalizeQuotePreference(input = {}) {
  const mode = quoteModes.includes(input.mode) ? input.mode : 'motivation';
  return {
    mode,
    customMessage: mode === 'custom' ? input.customMessage?.trim() || '' : ''
  };
}

export function calculateNextReminderAt(reminderAt, reminderOffsetMinutes = 0) {
  const scheduled = new Date(reminderAt).getTime();
  if (Number.isNaN(scheduled)) return null;
  return new Date(scheduled - reminderOffsetMinutes * 60 * 1000).toISOString();
}

export class TaskStore {
  constructor(filePath = defaultPath) {
    this.filePath = filePath;
  }

  async ensureFile() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, '[]\n', 'utf8');
    }
  }

  async readAll() {
    await this.ensureFile();
    const raw = await fs.readFile(this.filePath, 'utf8');
    return JSON.parse(raw || '[]').map((task) => this.withDefaults(task));
  }

  async writeAll(tasks) {
    await this.ensureFile();
    await fs.writeFile(this.filePath, `${JSON.stringify(tasks, null, 2)}\n`, 'utf8');
  }

  async create(input) {
    const tasks = await this.readAll();
    const now = new Date().toISOString();
    const reminderOffsetMinutes = normalizeCustomMinutes(input.reminderOffsetMinutes, reminderOffsets);
    const repeatIntervalMinutes = normalizeCustomMinutes(input.repeatIntervalMinutes, repeatIntervals);
    const reminderAt = new Date(input.reminderAt).toISOString();
    const minActiveOrder = tasks
      .filter((existing) => !existing.completed && Number.isFinite(existing.order))
      .reduce((min, existing) => Math.min(min, existing.order), 0);
    const task = {
      id: crypto.randomUUID(),
      title: input.title.trim(),
      description: input.description?.trim() || '',
      reminderAt,
      reminderOffsetMinutes,
      repeatIntervalMinutes,
      nextReminderAt: calculateNextReminderAt(reminderAt, reminderOffsetMinutes),
      reminderCount: 0,
      quotePreference: normalizeQuotePreference(input.quotePreference),
      nudgeTone: normalizeNudgeTone(input.nudgeTone),
      lastReminder: null,
      completed: false,
      remindedAt: null,
      order: minActiveOrder - 1,
      createdAt: now,
      updatedAt: now
    };
    tasks.unshift(task);
    await this.writeAll(tasks);
    return task;
  }

  withDefaults(task) {
    const reminderOffsetMinutes = normalizeCustomMinutes(task.reminderOffsetMinutes, reminderOffsets);
    const repeatIntervalMinutes = normalizeCustomMinutes(task.repeatIntervalMinutes, repeatIntervals);
    const completed = Boolean(task.completed);
    const fallbackNextReminderAt =
      task.remindedAt && repeatIntervalMinutes === 0
        ? null
        : calculateNextReminderAt(task.reminderAt, reminderOffsetMinutes);
    const fallbackOrder = task.createdAt ? -new Date(task.createdAt).getTime() : 0;
    return {
      ...task,
      reminderOffsetMinutes,
      repeatIntervalMinutes,
      reminderCount: Number.isInteger(task.reminderCount) ? task.reminderCount : task.remindedAt ? 1 : 0,
      nextReminderAt: completed ? null : task.nextReminderAt ?? fallbackNextReminderAt,
      quotePreference: normalizeQuotePreference(task.quotePreference),
      nudgeTone: normalizeNudgeTone(task.nudgeTone),
      order: Number.isFinite(task.order) ? task.order : fallbackOrder
    };
  }

  async update(id, patch) {
    const tasks = await this.readAll();
    const index = tasks.findIndex((task) => task.id === id);
    if (index === -1) return null;

    const current = tasks[index];
    const updated = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: new Date().toISOString()
    };

    const patchedReminderAt = patch.reminderAt ? new Date(patch.reminderAt).toISOString() : null;
    const patchedOffset =
      patch.reminderOffsetMinutes !== undefined
        ? normalizeCustomMinutes(patch.reminderOffsetMinutes, reminderOffsets)
        : null;
    const reminderAtChanged = patchedReminderAt !== null && patchedReminderAt !== current.reminderAt;
    const offsetChanged = patchedOffset !== null && patchedOffset !== current.reminderOffsetMinutes;

    if (patchedReminderAt) {
      updated.reminderAt = patchedReminderAt;
    }
    if (patchedOffset !== null) {
      updated.reminderOffsetMinutes = patchedOffset;
    }

    if (reminderAtChanged || offsetChanged) {
      updated.nextReminderAt = updated.completed
        ? null
        : calculateNextReminderAt(updated.reminderAt, updated.reminderOffsetMinutes);
      updated.reminderCount = 0;
      updated.remindedAt = null;
      updated.lastReminder = null;
    }

    if (patch.repeatIntervalMinutes !== undefined) {
      updated.repeatIntervalMinutes = normalizeCustomMinutes(patch.repeatIntervalMinutes, repeatIntervals);
    }

    if (patch.quotePreference) {
      updated.quotePreference = normalizeQuotePreference(patch.quotePreference);
    }

    if (patch.nudgeTone !== undefined) {
      updated.nudgeTone = normalizeNudgeTone(patch.nudgeTone);
    }

    if (patch.completed === true) {
      updated.nextReminderAt = null;
    } else if (patch.completed === false && !updated.nextReminderAt) {
      updated.nextReminderAt = calculateNextReminderAt(updated.reminderAt, updated.reminderOffsetMinutes);
    }

    tasks[index] = updated;
    await this.writeAll(tasks);
    return updated;
  }

  async delete(id) {
    const tasks = await this.readAll();
    const nextTasks = tasks.filter((task) => task.id !== id);
    if (nextTasks.length === tasks.length) return false;
    await this.writeAll(nextTasks);
    return true;
  }

  async reorder(orderedIds) {
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
      return { tasks: null, error: 'order must be an array of task ids.' };
    }
    const tasks = await this.readAll();
    const idIndex = new Map(orderedIds.map((id, index) => [id, index]));
    const missing = orderedIds.filter((id) => !tasks.some((task) => task.id === id));
    if (missing.length) {
      return { tasks: null, error: `Unknown task id(s): ${missing.join(', ')}` };
    }
    const now = new Date().toISOString();
    const updated = tasks.map((task) =>
      idIndex.has(task.id)
        ? { ...task, order: idIndex.get(task.id), updatedAt: now }
        : task
    );
    await this.writeAll(updated);
    return { tasks: updated, error: null };
  }

  async snooze(id, minutes) {
    const snoozeMinutes = normalizeMinutes(minutes, snoozeIntervals, null);
    if (!snoozeMinutes) return { task: null, error: 'Invalid snooze interval.' };

    const tasks = await this.readAll();
    const task = tasks.find((item) => item.id === id);
    if (!task) return { task: null, error: 'Task not found.' };
    if (task.completed) return { task: null, error: 'Completed tasks cannot be snoozed.' };

    const nextReminderAt = new Date(Date.now() + snoozeMinutes * 60 * 1000).toISOString();
    return {
      task: await this.update(id, { nextReminderAt }),
      error: null
    };
  }
}

export function validateTaskInput(input) {
  const errors = [];
  if (!input?.title || !input.title.trim()) {
    errors.push('Title is required.');
  }
  if (!input?.reminderAt || Number.isNaN(new Date(input.reminderAt).getTime())) {
    errors.push('A valid reminder date/time is required.');
  }
  if (input?.quotePreference?.mode === 'custom' && !input.quotePreference.customMessage?.trim()) {
    errors.push('Custom message is required when custom message is selected.');
  }
  if (
    input?.reminderOffsetMinutes !== undefined &&
    !isValidCustomMinutes(input.reminderOffsetMinutes, reminderOffsets)
  ) {
    errors.push('Reminder timing must be 0, 5, 10, 20, or a custom value from 1 to 1440 minutes.');
  }
  if (
    input?.repeatIntervalMinutes !== undefined &&
    !isValidCustomMinutes(input.repeatIntervalMinutes, repeatIntervals)
  ) {
    errors.push('Repeat interval must be 0, 5, 10, 20, or a custom value from 1 to 1440 minutes.');
  }
  if (input?.nudgeTone !== undefined && !nudgeTones.includes(input.nudgeTone)) {
    errors.push('Nudge tone must be supportive, direct, or tough.');
  }
  return errors;
}

function isValidCustomMinutes(value, allowed) {
  const minutes = Number(value);
  return allowed.includes(minutes) || (Number.isFinite(minutes) && minutes > 0 && minutes <= maxCustomMinutes);
}
