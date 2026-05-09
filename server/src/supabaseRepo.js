import { createClient } from '@supabase/supabase-js';
import {
  buildNewTask,
  applyTaskUpdate,
  normalizeSnoozeMinutes
} from './storage.js';
import { toDbRow, fromDbRow } from './taskMapping.js';

// SupabaseTaskRepo mirrors JsonTaskRepo's surface so the route layer never
// has to know which backend is in use. In phase 3 the repo runs everything
// through the service-role client because we have not enabled auth yet —
// ownership is enforced explicitly via `eq('user_id', userId)` filters. Phase
// 5 will introduce per-request user-scoped clients so RLS does the filtering
// for user-facing CRUD; the service-role client will stay around for the
// scheduler's cross-user reads.

const SYSTEM_FIELDS_TO_STRIP = ['id', 'user_id', 'created_at'];

function buildPatchRow(updatedTask) {
  const row = toDbRow(updatedTask);
  for (const field of SYSTEM_FIELDS_TO_STRIP) {
    delete row[field];
  }
  // The trigger in schema.sql sets updated_at; let it own that column.
  delete row.updated_at;
  return row;
}

export class SupabaseTaskRepo {
  constructor({ url, serviceRoleKey, client } = {}) {
    if (client) {
      this.client = client;
    } else {
      if (!url || !serviceRoleKey) {
        throw new Error(
          'SupabaseTaskRepo requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        );
      }
      this.client = createClient(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
    }
  }

  async listForUser(userId) {
    const { data, error } = await this.client
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('order', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(fromDbRow);
  }

  async create(userId, input) {
    const { data: existingRows, error: readError } = await this.client
      .from('tasks')
      .select('*')
      .eq('user_id', userId);
    if (readError) throw new Error(readError.message);
    const existing = (existingRows || []).map(fromDbRow);

    const task = buildNewTask({ ...input, user_id: userId }, existing);
    const insertRow = toDbRow(task);

    const { data, error } = await this.client
      .from('tasks')
      .insert(insertRow)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return fromDbRow(data);
  }

  async update(userId, id, patch) {
    const current = await this.#fetchOwned(userId, id);
    if (!current) return { task: null, status: 404 };
    const updated = applyTaskUpdate(current, patch);
    const patchRow = buildPatchRow(updated);

    const { data, error } = await this.client
      .from('tasks')
      .update(patchRow)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { task: fromDbRow(data), status: 200 };
  }

  async delete(userId, id) {
    const { data, error } = await this.client
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return { deleted: false, status: 404 };
    return { deleted: true, status: 204 };
  }

  async snooze(userId, id, minutes) {
    const snoozeMinutes = normalizeSnoozeMinutes(minutes);
    if (!snoozeMinutes) {
      return { task: null, error: 'Invalid snooze interval.', status: 400 };
    }
    const current = await this.#fetchOwned(userId, id);
    if (!current) return { task: null, error: 'Task not found.', status: 404 };
    if (current.completed) {
      return { task: null, error: 'Completed tasks cannot be snoozed.', status: 400 };
    }
    const nextReminderAt = new Date(Date.now() + snoozeMinutes * 60 * 1000).toISOString();
    const { task, status } = await this.update(userId, id, { nextReminderAt });
    return { task, error: null, status };
  }

  async reorder(userId, orderedIds) {
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
      return { tasks: null, error: 'order must be an array of task ids.', status: 400 };
    }
    if (orderedIds.length === 0) {
      return { tasks: [], error: null, status: 200 };
    }

    const { data: ownedRows, error: ownErr } = await this.client
      .from('tasks')
      .select('id')
      .eq('user_id', userId)
      .in('id', orderedIds);
    if (ownErr) throw new Error(ownErr.message);
    const owned = new Set((ownedRows || []).map((row) => row.id));
    const stranger = orderedIds.find((id) => !owned.has(id));
    if (stranger) {
      return { tasks: null, error: `Unknown task id(s): ${stranger}`, status: 400 };
    }

    // Postgres has no portable single-statement reorder, so issue per-row
    // updates. With drag-and-drop on a small active list this is fine; if it
    // becomes a hotspot we can move it into a SECURITY DEFINER function.
    const writes = orderedIds.map((id, index) =>
      this.client
        .from('tasks')
        .update({ order: index })
        .eq('id', id)
        .eq('user_id', userId)
    );
    const results = await Promise.all(writes);
    const failure = results.find((result) => result.error);
    if (failure) throw new Error(failure.error.message);

    const tasks = await this.listForUser(userId);
    return { tasks, error: null, status: 200 };
  }

  async listAllDue() {
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from('tasks')
      .select('*')
      .eq('completed', false)
      .not('next_reminder_at', 'is', null)
      .lte('next_reminder_at', now);
    if (error) throw new Error(error.message);
    return (data || []).map(fromDbRow);
  }

  async applyReminderResult(taskId, patch) {
    // Scheduler call — system-wide, no userId scoping.
    const { data: row, error: readErr } = await this.client
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) return null;

    const updated = applyTaskUpdate(fromDbRow(row), patch);
    const patchRow = buildPatchRow(updated);

    const { data, error } = await this.client
      .from('tasks')
      .update(patchRow)
      .eq('id', taskId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return fromDbRow(data);
  }

  async #fetchOwned(userId, id) {
    const { data, error } = await this.client
      .from('tasks')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return fromDbRow(data);
  }
}
