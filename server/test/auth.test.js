import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/index.js';
import { TaskStore } from '../src/storage.js';
import { validateAuthConfig } from '../src/config.js';

const TEST_SECRET = 'phase5-test-jwt-secret-do-not-use-in-prod';
const TEST_USER = '11111111-1111-1111-1111-111111111111';

function makeJwt({
  sub = TEST_USER,
  audience = 'authenticated',
  expiresIn = '5m',
  secret = TEST_SECRET,
  algorithm = 'HS256'
} = {}) {
  return jwt.sign({ sub }, secret, { algorithm, audience, expiresIn });
}

function withSupabaseEnv() {
  const saved = {
    AUTH_MODE: process.env.AUTH_MODE,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET
  };
  process.env.AUTH_MODE = 'supabase';
  process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
  return () => {
    if (saved.AUTH_MODE === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = saved.AUTH_MODE;
    if (saved.SUPABASE_JWT_SECRET === undefined) delete process.env.SUPABASE_JWT_SECRET;
    else process.env.SUPABASE_JWT_SECRET = saved.SUPABASE_JWT_SECRET;
  };
}

async function startServer() {
  const dir = await mkdtemp(path.join(tmpdir(), 'motivateme-auth-'));
  const store = new TaskStore(path.join(dir, 'tasks.json'));
  const scheduler = { on() {}, start() {}, stop() {} };
  const app = createApp({ store, scheduler });
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    store,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  };
}

test('validateAuthConfig: AUTH_MODE=supabase without SUPABASE_JWT_SECRET fails clearly', () => {
  const saved = {
    AUTH_MODE: process.env.AUTH_MODE,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET
  };
  process.env.AUTH_MODE = 'supabase';
  delete process.env.SUPABASE_JWT_SECRET;
  try {
    assert.throws(() => validateAuthConfig(), /SUPABASE_JWT_SECRET/);
  } finally {
    if (saved.AUTH_MODE === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = saved.AUTH_MODE;
    if (saved.SUPABASE_JWT_SECRET !== undefined) {
      process.env.SUPABASE_JWT_SECRET = saved.SUPABASE_JWT_SECRET;
    }
  }
});

test('validateAuthConfig: unknown AUTH_MODE rejects', () => {
  const saved = process.env.AUTH_MODE;
  process.env.AUTH_MODE = 'firebase';
  try {
    assert.throws(() => validateAuthConfig(), /Unknown AUTH_MODE/);
  } finally {
    if (saved === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = saved;
  }
});

test('off mode: requests succeed without an Authorization header', async () => {
  // No env mutation — default state is AUTH_MODE=off.
  const server = await startServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/tasks`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
  } finally {
    await server.close();
  }
});

test('supabase mode: missing Authorization rejected with 401', async () => {
  const restore = withSupabaseEnv();
  let server;
  try {
    server = await startServer();
    const res = await fetch(`${server.baseUrl}/api/tasks`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /Missing Authorization/);
  } finally {
    if (server) await server.close();
    restore();
  }
});

test('supabase mode: malformed bearer rejected with 401', async () => {
  const restore = withSupabaseEnv();
  let server;
  try {
    server = await startServer();
    const res = await fetch(`${server.baseUrl}/api/tasks`, {
      headers: { Authorization: 'Token abc.def.ghi' }
    });
    assert.equal(res.status, 401);
  } finally {
    if (server) await server.close();
    restore();
  }
});

test('supabase mode: invalid signature rejected with 401', async () => {
  const restore = withSupabaseEnv();
  let server;
  try {
    server = await startServer();
    const wrong = makeJwt({ secret: 'a-different-secret' });
    const res = await fetch(`${server.baseUrl}/api/tasks`, {
      headers: { Authorization: `Bearer ${wrong}` }
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /Invalid token/);
  } finally {
    if (server) await server.close();
    restore();
  }
});

test('supabase mode: expired token rejected with 401', async () => {
  const restore = withSupabaseEnv();
  let server;
  try {
    server = await startServer();
    const expired = jwt.sign({ sub: TEST_USER }, TEST_SECRET, {
      algorithm: 'HS256',
      audience: 'authenticated',
      expiresIn: -10
    });
    const res = await fetch(`${server.baseUrl}/api/tasks`, {
      headers: { Authorization: `Bearer ${expired}` }
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /expired/i);
  } finally {
    if (server) await server.close();
    restore();
  }
});

test('supabase mode: anon-audience tokens rejected', async () => {
  const restore = withSupabaseEnv();
  let server;
  try {
    server = await startServer();
    const anon = makeJwt({ audience: 'anon' });
    const res = await fetch(`${server.baseUrl}/api/tasks`, {
      headers: { Authorization: `Bearer ${anon}` }
    });
    assert.equal(res.status, 401);
  } finally {
    if (server) await server.close();
    restore();
  }
});

test('supabase mode: valid JWT lists tasks scoped to req.userId from sub', async () => {
  const restore = withSupabaseEnv();
  let server;
  try {
    server = await startServer();
    const token = makeJwt();

    // Seed a task owned by the JWT subject directly through the store.
    await server.store.create({
      user_id: TEST_USER,
      title: 'Mine',
      reminderAt: new Date(Date.now() + 600000).toISOString()
    });
    // Seed a task owned by a different user — must not appear.
    await server.store.create({
      user_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      title: 'Theirs',
      reminderAt: new Date(Date.now() + 600000).toISOString()
    });

    const res = await fetch(`${server.baseUrl}/api/tasks`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 1);
    assert.equal(body[0].title, 'Mine');
    assert.equal(body[0].user_id, TEST_USER);
  } finally {
    if (server) await server.close();
    restore();
  }
});

test('supabase mode: user_id in request body cannot override the verified subject', async () => {
  const restore = withSupabaseEnv();
  let server;
  try {
    server = await startServer();
    const token = makeJwt();
    const res = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        title: 'Trying to spoof user_id',
        reminderAt: new Date(Date.now() + 600000).toISOString(),
        user_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff'
      })
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.user_id, TEST_USER);
  } finally {
    if (server) await server.close();
    restore();
  }
});

test('supabase mode: /api/content/quote requires a token', async () => {
  const restore = withSupabaseEnv();
  let server;
  try {
    server = await startServer();
    const noTokenRes = await fetch(`${server.baseUrl}/api/content/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Read chapter' })
    });
    assert.equal(noTokenRes.status, 401);

    const token = makeJwt();
    const okRes = await fetch(`${server.baseUrl}/api/content/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ title: 'Read chapter' })
    });
    assert.equal(okRes.status, 200);
  } finally {
    if (server) await server.close();
    restore();
  }
});

test('supabase mode: SSE rejects without ?token=, accepts with valid token', async () => {
  const restore = withSupabaseEnv();
  let server;
  try {
    server = await startServer();

    // No token — 401.
    const noTokenRes = await fetch(`${server.baseUrl}/api/reminders/stream`);
    assert.equal(noTokenRes.status, 401);
    await noTokenRes.body?.cancel?.();

    // Invalid token — 401.
    const badTokenRes = await fetch(
      `${server.baseUrl}/api/reminders/stream?token=not-a-jwt`
    );
    assert.equal(badTokenRes.status, 401);
    await badTokenRes.body?.cancel?.();

    // Valid token — connection opens with text/event-stream.
    const token = makeJwt();
    const controller = new AbortController();
    const okRes = await fetch(
      `${server.baseUrl}/api/reminders/stream?token=${encodeURIComponent(token)}`,
      { signal: controller.signal }
    );
    assert.equal(okRes.status, 200);
    assert.match(okRes.headers.get('content-type') || '', /text\/event-stream/);
    controller.abort();
  } finally {
    if (server) await server.close();
    restore();
  }
});

test('off mode: SSE accepts unauthenticated connections (existing behavior)', async () => {
  const server = await startServer();
  try {
    const controller = new AbortController();
    const res = await fetch(`${server.baseUrl}/api/reminders/stream`, {
      signal: controller.signal
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
    controller.abort();
  } finally {
    await server.close();
  }
});
