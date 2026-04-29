import { EventEmitter } from 'node:events';
import { generateContent } from './content/index.js';

export class ReminderScheduler extends EventEmitter {
  constructor(store, { intervalMs = 15000, lookbackMs = 60000 } = {}) {
    super();
    this.store = store;
    this.intervalMs = intervalMs;
    this.lookbackMs = lookbackMs;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.checkDueTasks();
    this.timer = setInterval(() => this.checkDueTasks(), this.intervalMs);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async checkDueTasks() {
    const now = Date.now();
    const tasks = await this.store.readAll();
    const dueTasks = tasks.filter((task) => {
      const reminderTime = new Date(task.nextReminderAt).getTime();
      return !task.completed && task.nextReminderAt && reminderTime <= now;
    });

    for (const task of dueTasks) {
      try {
        const quote = await generateContent('quote', { task });
        const reminder = {
          id: crypto.randomUUID(),
          taskId: task.id,
          taskTitle: task.title,
          reminderAt: task.reminderAt,
          nextReminderAt: task.nextReminderAt,
          reminderCount: (task.reminderCount || 0) + 1,
          quote,
          deliveredAt: new Date().toISOString()
        };
        console.log(`[MotivateMe Reminder] ${task.title}: ${quote.text} - ${quote.author}`);
        const nextReminderAt =
          task.repeatIntervalMinutes > 0
            ? new Date(Date.now() + task.repeatIntervalMinutes * 60 * 1000).toISOString()
            : null;
        await this.store.update(task.id, {
          remindedAt: reminder.deliveredAt,
          lastReminder: quote,
          nextReminderAt,
          reminderCount: reminder.reminderCount
        });
        reminder.followUpAt = nextReminderAt;
        this.emit('reminder', reminder);
      } catch (error) {
        console.error('Failed to deliver reminder:', error);
      }
    }
  }
}
