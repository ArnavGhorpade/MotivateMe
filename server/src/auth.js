import jwt from 'jsonwebtoken';
import { DEFAULT_LOCAL_USER_ID } from './config.js';

// Auth runtime configuration is read from process.env at every call so tests
// can flip modes between cases without juggling dynamic imports. Production
// behavior is identical to a single read because env vars don't change after
// startup.
function readEnv() {
  return {
    mode: (process.env.AUTH_MODE || 'off').toLowerCase(),
    localUserId: process.env.LOCAL_USER_ID || DEFAULT_LOCAL_USER_ID,
    secret: process.env.SUPABASE_JWT_SECRET || ''
  };
}

function extractBearer(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const parts = String(header).trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  const token = parts[1].trim();
  return token || null;
}

function verifySupabaseJwt(token, secret) {
  // Supabase signs HS256 tokens with the project's JWT secret. Authenticated
  // user tokens always carry aud="authenticated"; this check rejects anon
  // tokens (which Supabase signs with the same secret but under aud="anon")
  // so they cannot reach protected routes.
  return jwt.verify(token, secret, {
    algorithms: ['HS256'],
    audience: 'authenticated'
  });
}

function rejectWith(res, status, error) {
  res.status(status).json({ error });
  return false;
}

function attachUserFromToken(token, secret, req, res) {
  let payload;
  try {
    payload = verifySupabaseJwt(token, secret);
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      return rejectWith(res, 401, 'Token expired.');
    }
    if (err?.name === 'JsonWebTokenError') {
      return rejectWith(res, 401, 'Invalid token.');
    }
    return rejectWith(res, 401, 'Token verification failed.');
  }
  const sub = payload && typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub) {
    return rejectWith(res, 401, 'Token missing subject.');
  }
  req.userId = sub;
  return true;
}

export function authMiddleware(req, res, next) {
  const { mode, localUserId, secret } = readEnv();

  if (mode === 'off') {
    req.userId = localUserId;
    return next();
  }

  if (mode !== 'supabase') {
    return rejectWith(res, 501, `Auth mode "${mode}" not supported.`);
  }

  if (!secret) {
    // Validated at startup; this branch is a defensive fallback so a
    // misconfigured deploy fails closed instead of allowing requests through.
    return rejectWith(res, 500, 'Server auth misconfigured.');
  }

  const token = extractBearer(req);
  if (!token) {
    return rejectWith(res, 401, 'Missing Authorization bearer token.');
  }
  if (attachUserFromToken(token, secret, req, res)) {
    return next();
  }
}

// EventSource cannot send custom headers, so the SSE endpoint accepts the
// token as a query parameter. Otherwise the verification path is identical to
// authMiddleware and uses the same SUPABASE_JWT_SECRET.
export function sseAuthMiddleware(req, res, next) {
  const { mode, localUserId, secret } = readEnv();

  if (mode === 'off') {
    req.userId = localUserId;
    return next();
  }

  if (mode !== 'supabase') {
    return rejectWith(res, 501, `Auth mode "${mode}" not supported.`);
  }

  if (!secret) {
    return rejectWith(res, 500, 'Server auth misconfigured.');
  }

  const raw = req.query?.token;
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (!token) {
    return rejectWith(res, 401, 'Missing token query parameter.');
  }
  if (attachUserFromToken(token, secret, req, res)) {
    return next();
  }
}
