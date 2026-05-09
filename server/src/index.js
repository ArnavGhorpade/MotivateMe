import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pathToFileURL } from 'node:url';
import { TaskStore, validateTaskInput } from './storage.js';
import { JsonTaskRepo } from './repo.js';
import { SupabaseTaskRepo } from './supabaseRepo.js';
import { ReminderScheduler } from './reminderScheduler.js';
import { generateContent, listContentTypes, listQuoteOptions } from './content/index.js';
import { authMiddleware } from './auth.js';
import {
  DATA_BACKEND,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  validateBackendConfig
} from './config.js';

function buildDefaultRepo() {
  validateBackendConfig();
  if (DATA_BACKEND === 'supabase') {
    return new SupabaseTaskRepo({
      url: SUPABASE_URL,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY
    });
  }
  return new JsonTaskRepo(new TaskStore());
}

export function createApp({ store, repo, scheduler } = {}) {
  let taskRepo = repo;
  if (!taskRepo) {
    taskRepo = store ? new JsonTaskRepo(store) : buildDefaultRepo();
  }
  const app = express();
  const activeClients = new Set();
  const reminderScheduler = scheduler || new ReminderScheduler(taskRepo);
  const allowedOrigins = new Set(
    [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      process.env.FRONTEND_URL
    ].filter(Boolean)
  );

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`CORS blocked origin: ${origin}`));
      }
    })
  );
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, contentTypes: listContentTypes(), quoteOptions: listQuoteOptions() });
  });

  // All task routes go through authMiddleware so req.userId is populated.
  // In AUTH_MODE=off this is a no-op that assigns LOCAL_USER_ID.
  app.use('/api/tasks', authMiddleware);

  app.get('/api/tasks', async (req, res, next) => {
    try {
      res.json(await taskRepo.listForUser(req.userId));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/tasks', async (req, res, next) => {
    try {
      const errors = validateTaskInput(req.body);
      if (errors.length) {
        return res.status(400).json({ errors });
      }
      const task = await taskRepo.create(req.userId, req.body);
      return res.status(201).json(task);
    } catch (error) {
      return next(error);
    }
  });

  // PUT /api/tasks/order must come before PATCH /api/tasks/:id so the
  // 'order' literal is not consumed as an :id parameter.
  app.put('/api/tasks/order', async (req, res, next) => {
    try {
      const { tasks, error, status } = await taskRepo.reorder(req.userId, req.body?.order);
      if (!tasks) {
        return res.status(status || 400).json({ error });
      }
      return res.json(tasks);
    } catch (error) {
      return next(error);
    }
  });

  app.patch('/api/tasks/:id', async (req, res, next) => {
    try {
      const allowed = [
        'title',
        'description',
        'reminderAt',
        'reminderOffsetMinutes',
        'repeatIntervalMinutes',
        'nextReminderAt',
        'reminderCount',
        'quotePreference',
        'nudgeTone',
        'lastReminder',
        'completed',
        'remindedAt'
      ];
      const patch = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
      const { task, status } = await taskRepo.update(req.userId, req.params.id, patch);
      if (!task) {
        return res.status(status).json({ error: 'Task not found.' });
      }
      return res.json(task);
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/tasks/:id', async (req, res, next) => {
    try {
      const { deleted, status } = await taskRepo.delete(req.userId, req.params.id);
      if (!deleted) {
        return res.status(status).json({ error: 'Task not found.' });
      }
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/tasks/:id/snooze', async (req, res, next) => {
    try {
      const { task, error, status } = await taskRepo.snooze(
        req.userId,
        req.params.id,
        req.body?.minutes
      );
      if (!task) {
        return res.status(status || 400).json({ error });
      }
      return res.json(task);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/content/quote', async (req, res, next) => {
    try {
      const quote = await generateContent('quote', {
        task: {
          title: req.body?.title || 'study task',
          quotePreference: req.body?.quotePreference
        }
      });
      res.json(quote);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/content/motivational-quote', async (req, res, next) => {
    try {
      const quote = await generateContent('quote', {
        task: {
          title: req.body?.title || 'study task',
          quotePreference: { mode: 'motivation' }
        }
      });
      res.json(quote);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/reminders/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (payload) => {
      res.write(`event: reminder\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    activeClients.add(send);
    req.on('close', () => activeClients.delete(send));
  });

  reminderScheduler.on('reminder', (reminder) => {
    for (const send of activeClients) {
      send(reminder);
    }
  });

  app.locals.scheduler = reminderScheduler;

  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.PORT || 4000;
  const app = createApp();
  app.listen(port, () => {
    app.locals.scheduler.start();
    console.log(`MotivateMe API running on http://localhost:${port}`);
  });
}
