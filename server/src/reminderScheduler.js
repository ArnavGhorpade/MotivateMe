import { EventEmitter } from 'node:events';
import { generateContent } from './content/index.js';
import { generateNudge, nudgeStageForCount } from './content/nudges.js';

const initialSourceLabels = {
  custom: 'Custom message',
  motivation: 'Curated local quote',
  wisdom: 'Curated local quote'
};

const toneLabels = {
  supportive: 'Supportive nudge',
  direct: 'Direct nudge',
  tough: 'Tough nudge'
};

async function buildReminderQuote(task) {
  const tone = task.nudgeTone || 'supportive';
  const stage = nudgeStageForCount(task.reminderCount);

  if (stage === 'initial') {
    const quote = await generateContent('quote', { task });
    return {
      ...quote,
      tone,
      stage: 'initial',
      sourceLabel: initialSourceLabels[quote.source] || initialSourceLabels[quote.type] || 'Curated local quote',
      toneLabel: toneLabels[tone]
    };
  }

  return generateNudge({ stage, tone, title: task.title });
}

export class ReminderScheduler extends EventEmitter {
  constructor(repo, { intervalMs = 15000, lookbackMs = 60000 } = {}) {
    super();
    this.repo = repo;
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
    const dueTasks = await this.repo.listAllDue();

    for (const task of dueTasks) {
      try {
        const quote = await buildReminderQuote(task);
        const reminder = {
          id: crypto.randomUUID(),
          taskId: task.id,
          // userId travels with the reminder so phase 6 SSE can route to the
          // owning user's connected clients.
          userId: task.user_id,
          taskTitle: task.title,
          taskDescription: task.description || '',
          reminderAt: task.reminderAt,
          nextReminderAt: task.nextReminderAt,
          reminderCount: (task.reminderCount || 0) + 1,
          nudgeTone: task.nudgeTone || 'supportive',
          nudgeStage: quote.stage,
          quote,
          deliveredAt: new Date().toISOString()
        };
        console.log(`[MotivateMe Reminder] ${task.title}: ${quote.text} - ${quote.author}`);
        const nextReminderAt =
          task.repeatIntervalMinutes > 0
            ? new Date(Date.now() + task.repeatIntervalMinutes * 60 * 1000).toISOString()
            : null;
        await this.repo.applyReminderResult(task.id, {
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
