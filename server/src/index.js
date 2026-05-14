import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pathToFileURL } from 'node:url';
import { TaskStore, validateTaskInput } from './storage.js';
import { JsonTaskRepo } from './repo.js';
import { SupabaseTaskRepo } from './supabaseRepo.js';
import { ReminderScheduler } from './reminderScheduler.js';
import { generateContent, listContentTypes, listQuoteOptions } from './content/index.js';
import { authMiddleware, sseAuthMiddleware } from './auth.js';
import {
  ownerGateMiddleware,
  ownerSseGateMiddleware,
  validateOwnerConfig,
  verifyOwnerPassword,
  issueOwnerToken,
  isOwnerGateEnabled,
  sessionStatus,
  TOKEN_EXPIRY_SECONDS as OWNER_TOKEN_EXPIRY_SECONDS
} from './ownerAuth.js';
import {
  DATA_BACKEND,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  validateBackendConfig,
  validateAuthConfig
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
  // Fail fast if AUTH_MODE=supabase is configured without the JWT secret;
  // off-mode passes through with no requirements.
  validateAuthConfig();
  // Fail fast if owner gate is misconfigured (production without password,
  // or password without session secret).
  validateOwnerConfig();

  let taskRepo = repo;
  if (!taskRepo) {
    taskRepo = store ? new JsonTaskRepo(store) : buildDefaultRepo();
  }
  const app = express();
  // Per-user SSE registry. Keys are userIds (LOCAL_USER_ID in off mode, the
  // verified JWT subject in supabase mode). Each entry is a Set so a single
  // user with multiple open tabs gets the reminder once per tab.
  const clientsByUser = new Map();
  const reminderScheduler = scheduler || new ReminderScheduler(taskRepo);

  function addClient(userId, send) {
    let set = clientsByUser.get(userId);
    if (!set) {
      set = new Set();
      clientsByUser.set(userId, set);
    }
    set.add(send);
  }

  function removeClient(userId, send) {
    const set = clientsByUser.get(userId);
    if (!set) return;
    set.delete(send);
    if (set.size === 0) clientsByUser.delete(userId);
  }
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

  // Public endpoints for the owner gate. /api/session is always 200 — the
  // frontend reads ownerGateEnabled/authenticated to decide whether to show
  // the login screen. /api/login returns 401 on a wrong password (with a
  // constant-time compare inside verifyOwnerPassword) or 400 if the gate is
  // disabled.
  app.get('/api/session', (req, res) => {
    res.json(sessionStatus(req));
  });

  app.post('/api/login', (req, res) => {
    if (!isOwnerGateEnabled()) {
      return res.status(400).json({ error: 'Owner gate is disabled.' });
    }
    const password = req.body?.password;
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Password is required.' });
    }
    if (!verifyOwnerPassword(password)) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    return res.json({
      token: issueOwnerToken(),
      expiresIn: OWNER_TOKEN_EXPIRY_SECONDS
    });
  });

  // Owner gate runs first so a missing/expired session token short-circuits
  // before per-user auth even sees the request. In AUTH_MODE=off the second
  // middleware assigns LOCAL_USER_ID; together they preserve the existing
  // single-user flow while keeping the app private.
  app.use('/api/tasks', ownerGateMiddleware, authMiddleware);
  app.use('/api/content', ownerGateMiddleware, authMiddleware);

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

  app.get('/api/reminders/stream', ownerSseGateMiddleware, sseAuthMiddleware, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const userId = req.userId;
    const send = (payload) => {
      res.write(`event: reminder\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    addClient(userId, send);

    // Heartbeat keeps proxies and load balancers from closing idle connections.
    // SSE comments (": …\n\n") are ignored by EventSource on the client.
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        // socket already closed; cleanup will run via 'close'
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      removeClient(userId, send);
    });
  });

  reminderScheduler.on('reminder', (reminder) => {
    // reminder.userId is set by the scheduler from task.user_id. Without it
    // we have no way to route safely, so drop the event rather than risk a
    // cross-user leak.
    const userId = reminder?.userId;
    if (!userId) return;
    const sends = clientsByUser.get(userId);
    if (!sends || sends.size === 0) return;
    for (const send of sends) {
      send(reminder);
    }
  });

  app.locals.scheduler = reminderScheduler;
  // Test hook so the SSE suite can verify the per-user map's shape without
  // asserting implementation details. Returns a snapshot — never the live Map.
  app.locals.activeClientUsers = () =>
    new Map(Array.from(clientsByUser.entries()).map(([id, set]) => [id, set.size]));

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
