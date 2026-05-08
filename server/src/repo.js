// JsonTaskRepo wraps TaskStore so route handlers can talk to a uniform
// per-user interface. Every user-facing method takes userId as the first
// argument and refuses to touch tasks owned by other users. The scheduler
// uses the system-level methods at the bottom (listAllDue,
// applyReminderResult) which are not user-scoped.
//
// Phase 3 will introduce SupabaseTaskRepo with the same shape, swapped in via
// a DATA_BACKEND flag. The route layer should not need to change again.

export class JsonTaskRepo {
  constructor(store) {
    this.store = store;
  }

  async listForUser(userId) {
    const tasks = await this.store.readAll();
    return tasks.filter((task) => task.user_id === userId);
  }

  async create(userId, input) {
    return this.store.create({ ...input, user_id: userId });
  }

  async update(userId, id, patch) {
    const owner = await this.#ownerOf(id);
    if (owner === null) return { task: null, status: 404 };
    if (owner !== userId) return { task: null, status: 404 };
    const task = await this.store.update(id, patch);
    return { task, status: 200 };
  }

  async delete(userId, id) {
    const owner = await this.#ownerOf(id);
    if (owner === null) return { deleted: false, status: 404 };
    if (owner !== userId) return { deleted: false, status: 404 };
    const deleted = await this.store.delete(id);
    return { deleted, status: deleted ? 204 : 404 };
  }

  async snooze(userId, id, minutes) {
    const owner = await this.#ownerOf(id);
    if (owner === null) return { task: null, error: 'Task not found.', status: 404 };
    if (owner !== userId) return { task: null, error: 'Task not found.', status: 404 };
    const result = await this.store.snooze(id, minutes);
    if (!result.task) {
      const status = result.error === 'Task not found.' ? 404 : 400;
      return { ...result, status };
    }
    return { ...result, status: 200 };
  }

  async reorder(userId, orderedIds) {
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
      return { tasks: null, error: 'order must be an array of task ids.', status: 400 };
    }
    const tasks = await this.store.readAll();
    const ownedIds = new Set(
      tasks.filter((task) => task.user_id === userId).map((task) => task.id)
    );
    const stranger = orderedIds.find((id) => !ownedIds.has(id));
    if (stranger) {
      return {
        tasks: null,
        error: `Unknown task id(s): ${stranger}`,
        status: 400
      };
    }
    const result = await this.store.reorder(orderedIds);
    if (!result.tasks) {
      return { ...result, status: 400 };
    }
    return {
      tasks: result.tasks.filter((task) => task.user_id === userId),
      error: null,
      status: 200
    };
  }

  // System-level — used by the reminder scheduler, not user-scoped.
  async listAllDue() {
    const tasks = await this.store.readAll();
    const now = Date.now();
    return tasks.filter((task) => {
      if (task.completed || !task.nextReminderAt) return false;
      const reminderTime = new Date(task.nextReminderAt).getTime();
      return Number.isFinite(reminderTime) && reminderTime <= now;
    });
  }

  async applyReminderResult(taskId, patch) {
    return this.store.update(taskId, patch);
  }

  async #ownerOf(id) {
    const tasks = await this.store.readAll();
    const task = tasks.find((item) => item.id === id);
    if (!task) return null;
    return task.user_id || null;
  }
}
