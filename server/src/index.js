import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pathToFileURL } from 'node:url';
import { TaskStore, validateTaskInput } from './storage.js';
import { ReminderScheduler } from './reminderScheduler.js';
import { generateContent, listContentTypes, listQuoteOptions } from './content/index.js';

export function createApp({ store = new TaskStore(), scheduler } = {}) {
  const app = express();
  const activeClients = new Set();
  const reminderScheduler = scheduler || new ReminderScheduler(store);
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

  app.get('/api/tasks', async (req, res, next) => {
    try {
      res.json(await store.readAll());
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
      const task = await store.create(req.body);
      return res.status(201).json(task);
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
        'lastReminder',
        'completed',
        'remindedAt'
      ];
      const patch = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
      const task = await store.update(req.params.id, patch);
      if (!task) {
        return res.status(404).json({ error: 'Task not found.' });
      }
      return res.json(task);
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/tasks/:id', async (req, res, next) => {
    try {
      const deleted = await store.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Task not found.' });
      }
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/tasks/:id/snooze', async (req, res, next) => {
    try {
      const { task, error } = await store.snooze(req.params.id, req.body?.minutes);
      if (!task) {
        return res.status(error === 'Task not found.' ? 404 : 400).json({ error });
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
