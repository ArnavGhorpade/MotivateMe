import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/index.js';
import { TaskStore } from '../src/storage.js';
import { validateOwnerConfig } from '../src/ownerAuth.js';

const TEST_PASSWORD = 'phase7-owner-password';
const TEST_SECRET = 'phase7-owner-session-secret-very-long';

function withOwnerEnv() {
  const saved = {
    OWNER_APP_PASSWORD: process.env.OWNER_APP_PASSWORD,
    OWNER_SESSION_SECRET: process.env.OWNER_SESSION_SECRET
  };
  process.env.OWNER_APP_PASSWORD = TEST_PASSWORD;
  process.env.OWNER_SESSION_SECRET = TEST_SECRET;
  return () => {
    if (saved.OWNER_APP_PASSWORD === undefined) delete process.env.OWNER_APP_PASSWORD;
    else process.env.OWNER_APP_PASSWORD = saved.OWNER_APP_PASSWORD;
    if (saved.OWNER_SESSION_SECRET === undefined) delete process.env.OWNER_SESSION_SECRET;
    else process.env.OWNER_SESSION_SECRET = saved.OWNER_SESSION_SECRET;
  };
}

async function startServer() {
  const dir = await mkdtemp(path.join(tmpdir(), 'motivateme-owner-'));
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

test('validateOwnerConfig: production without OWNER_APP_PASSWORD throws', () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    OWNER_APP_PASSWORD: process.env.OWNER_APP_PASSWORD,
    OWNER_SESSION_SECRET: process.env.OWNER_SESSION_SECRET
  };
  process.env.NODE_ENV = 'production';
  delete process.env.OWNER_APP_PASSWORD;
  delete process.env.OWNER_SESSION_SECRET;
  try {
    assert.throws(() => validateOwnerConfig(), /OWNER_APP_PASSWORD is required in production/);
  } finally {
    if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.OWNER_APP_PASSWORD !== undefined) process.env.OWNER_APP_PASSWORD = saved.OWNER_APP_PASSWORD;
    if (saved.OWNER_SESSION_SECRET !== undefined) process.env.OWNER_SESSION_SECRET = saved.OWNER_SESSION_SECRET;
  }
});

test('validateOwnerConfig: password set but secret missing throws', () => {
  const saved = {
    OWNER_APP_PASSWORD: process.env.OWNER_APP_PASSWORD,
    OWNER_SESSION_SECRET: process.env.OWNER_SESSION_SECRET
  };
  process.env.OWNER_APP_PASSWORD = 'something';
  delete process.env.OWNER_SESSION_SECRET;
  try {
    assert.throws(() => validateOwnerConfig(), /OWNER_SESSION_SECRET/);
  } finally {
    if (saved.OWNER_APP_PASSWORD === undefined) delete process.env.OWNER_APP_PASSWORD;
    else process.env.OWNER_APP_PASSWORD = saved.OWNER_APP_PASSWORD;
    if (saved.OWNER_SESSION_SECRET !== undefined) {
      process.env.OWNER_SESSION_SECRET = saved.OWNER_SESSION_SECRET;
    }
  }
});

test('validateOwnerConfig: dev without password is permitted', () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    OWNER_APP_PASSWORD: process.env.OWNER_APP_PASSWORD
  };
  delete process.env.NODE_ENV;
  delete process.env.OWNER_APP_PASSWORD;
  try {
    assert.doesNotThrow(() => validateOwnerConfig());
  } finally {
    if (saved.NODE_ENV !== undefined) process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.OWNER_APP_PASSWORD !== undefined) {
      process.env.OWNER_APP_PASSWORD = saved.OWNER_APP_PASSWORD;
    }
  }
});

test('gate disabled: /api/session reports ownerGateEnabled=false and routes are open', async () => {
  const server = await startServer();
  try {
    const sessionRes = await fetch(`${server.baseUrl}/api/session`);
    const sessionBody = await sessionRes.json();
    assert.equal(sessionBody.ownerGateEnabled, false);
    assert.equal(sessionBody.authenticated, true);

    const tasksRes = await fetch(`${server.baseUrl}/api/tasks`);
    assert.equal(tasksRes.status, 200);

    const loginRes = await fetch(`${server.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'anything' })
    });
    assert.equal(loginRes.status, 400);
  } finally {
    await server.close();
  }
});

test('gate enabled: protected routes return 401 without a token', async () => {
  const restore = withOwnerEnv();
  let server;
  try {
    server = await startServer();
    const tasksRes = await fetch(`${server.baseUrl}/api/tasks`);
    assert.equal(tasksRes.status, 401);

    const quoteRes = await fetch(`${server.baseUrl}/api/content/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Write notes' })
    });
    assert.equal(quoteRes.status, 401);

    const streamRes = await fetch(`${server.baseUrl}/api/reminders/stream`);
    assert.equal(streamRes.status, 401);
    await streamRes.body?.cancel?.();

    // /api/health stays public.
    const healthRes = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
  } finally {
    if (server) await server.close();
    restore();
  }
});

test('POST /api/login: wrong password rejected, right password returns a usable token', async () => {
  const restore = withOwnerEnv();
  let server;
  try {
    server = await startServer();

    const badRes = await fetch(`${server.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' })
    });
    assert.equal(badRes.status, 401);

    const emptyRes = await fetch(`${server.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(emptyRes.status, 400);

    const goodRes = await fetch(`${server.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD })
    });
    assert.equal(goodRes.status, 200);
    const { token, expiresIn } = await goodRes.json();
    assert.ok(typeof token === 'string' && token.length > 20);
    assert.equal(expiresIn, 7 * 24 * 60 * 60);

    // Use the token to fetch a protected route.
    const tasksRes = await fetch(`${server.baseUrl}/api/tasks`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(tasksRes.status, 200);

    // /api/session reflects the authenticated state.
    const sessionRes = await fetch(`${server.baseUrl}/api/session`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const sessionBody = await sessionRes.json();
    assert.equal(sessionBody.ownerGateEnabled, true);
    assert.equal(sessionBody.authenticated, true);
    assert.ok(sessionBody.expiresAt > Date.now());
  } finally {
    if (server) await server.close();
    restore();
  }
});

test('gate enabled: a token signed with a different secret is rejected', async () => {
  const restore = withOwnerEnv();
  let server;
  try {
    server = await startServer();
    const forged = jwt.sign({ role: 'owner' }, 'wrong-secret', {
      algorithm: 'HS256',
      audience: 'motivateme-owner',
      expiresIn: '5m'
    });
    const res = await fetch(`${server.baseUrl}/api/tasks`, {
      headers: { Authorization: `Bearer ${forged}` }
    });
    assert.equal(res.status, 401);
  } finally {
    if (server) await server.close();
    restore();
  }
});

test('gate enabled: an expired owner token is rejected', async () => {
  const restore = withOwnerEnv();
  let server;
  try {
    server = await startServer();
    const expired = jwt.sign({ role: 'owner' }, TEST_SECRET, {
      algorithm: 'HS256',
      audience: 'motivateme-owner',
      expiresIn: -10
    });
    const res = await fetch(`${server.baseUrl}/api/tasks`, {
      headers: { Authorization: `Bearer ${expired}` }
    });
    assert.equal(res.status, 401);
  } finally {
    if (server) await server.close();
    restore();
  }
});

test('gate enabled: SSE accepts the owner token via ?token=', async () => {
  const restore = withOwnerEnv();
  let server;
  try {
    server = await startServer();
    const loginRes = await fetch(`${server.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD })
    });
    const { token } = await loginRes.json();

    const controller = new AbortController();
    const res = await fetch(
      `${server.baseUrl}/api/reminders/stream?token=${encodeURIComponent(token)}`,
      { signal: controller.signal }
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
    controller.abort();
  } finally {
    if (server) await server.close();
    restore();
  }
});

test('gate enabled: an audience-mismatched token (e.g. supabase JWT) is rejected', async () => {
  const restore = withOwnerEnv();
  let server;
  try {
    server = await startServer();
    // Supabase tokens use aud="authenticated". They share an HS256 algorithm
    // but should never let a user past the owner gate.
    const supabaseLike = jwt.sign({ sub: 'someone' }, TEST_SECRET, {
      algorithm: 'HS256',
      audience: 'authenticated',
      expiresIn: '5m'
    });
    const res = await fetch(`${server.baseUrl}/api/tasks`, {
      headers: { Authorization: `Bearer ${supabaseLike}` }
    });
    assert.equal(res.status, 401);
  } finally {
    if (server) await server.close();
    restore();
  }
});
