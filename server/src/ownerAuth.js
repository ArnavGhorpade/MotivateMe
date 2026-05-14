import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'node:crypto';

// Owner gate: a single shared password protecting the entire deployed app.
// Separate from AUTH_MODE/Supabase. Tokens are HS256 JWTs signed with
// OWNER_SESSION_SECRET, scoped to aud="motivateme-owner" so a leaked
// Supabase token cannot pass owner verification and vice versa.

const TOKEN_AUDIENCE = 'motivateme-owner';
const TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

function readEnv() {
  return {
    password: process.env.OWNER_APP_PASSWORD || '',
    secret: process.env.OWNER_SESSION_SECRET || '',
    isProduction: process.env.NODE_ENV === 'production'
  };
}

export function isOwnerGateEnabled() {
  return Boolean(process.env.OWNER_APP_PASSWORD);
}

export function validateOwnerConfig() {
  const { password, secret, isProduction } = readEnv();
  if (password) {
    if (!secret) {
      throw new Error(
        'OWNER_APP_PASSWORD is set but OWNER_SESSION_SECRET is missing. ' +
          'Set OWNER_SESSION_SECRET to a long random string.'
      );
    }
  } else if (isProduction) {
    throw new Error(
      'OWNER_APP_PASSWORD is required in production. ' +
        'Set it (and OWNER_SESSION_SECRET) to gate the deployed app.'
    );
  }
}

function constantTimeEquals(provided, expected) {
  const a = Buffer.from(String(provided), 'utf8');
  const b = Buffer.from(String(expected), 'utf8');
  // timingSafeEqual requires equal lengths; pad the shorter one so a length
  // mismatch doesn't short-circuit the comparison.
  if (a.length !== b.length) {
    const max = Math.max(a.length, b.length);
    const padA = Buffer.alloc(max);
    const padB = Buffer.alloc(max);
    a.copy(padA);
    b.copy(padB);
    timingSafeEqual(padA, padB);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function verifyOwnerPassword(candidate) {
  const { password } = readEnv();
  if (!password) return false;
  return constantTimeEquals(candidate ?? '', password);
}

export function issueOwnerToken() {
  const { secret } = readEnv();
  if (!secret) {
    throw new Error('OWNER_SESSION_SECRET is not configured.');
  }
  return jwt.sign({ role: 'owner' }, secret, {
    algorithm: 'HS256',
    audience: TOKEN_AUDIENCE,
    subject: 'owner',
    expiresIn: TOKEN_EXPIRY_SECONDS
  });
}

export function verifyOwnerToken(token) {
  const { secret } = readEnv();
  if (!secret || !token) return null;
  try {
    return jwt.verify(token, secret, {
      algorithms: ['HS256'],
      audience: TOKEN_AUDIENCE
    });
  } catch {
    return null;
  }
}

function extractBearer(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const parts = String(header).trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  const token = parts[1].trim();
  return token || null;
}

function extractQueryToken(req) {
  const raw = req.query?.token;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

function rejectUnauthorized(res, reason) {
  res.status(401).json({ error: reason });
}

export function ownerGateMiddleware(req, res, next) {
  if (!isOwnerGateEnabled()) {
    return next();
  }
  const token = extractBearer(req);
  if (!token) {
    return rejectUnauthorized(res, 'Authentication required.');
  }
  if (!verifyOwnerToken(token)) {
    return rejectUnauthorized(res, 'Invalid or expired session.');
  }
  return next();
}

export function ownerSseGateMiddleware(req, res, next) {
  if (!isOwnerGateEnabled()) {
    return next();
  }
  // EventSource cannot send custom headers; SSE tokens ride as a query param.
  const token = extractQueryToken(req);
  if (!token) {
    return rejectUnauthorized(res, 'Authentication required.');
  }
  if (!verifyOwnerToken(token)) {
    return rejectUnauthorized(res, 'Invalid or expired session.');
  }
  return next();
}

export function sessionStatus(req) {
  if (!isOwnerGateEnabled()) {
    return { ownerGateEnabled: false, authenticated: true };
  }
  const token = extractBearer(req);
  const payload = token ? verifyOwnerToken(token) : null;
  if (!payload) {
    return { ownerGateEnabled: true, authenticated: false };
  }
  return {
    ownerGateEnabled: true,
    authenticated: true,
    expiresAt: payload.exp ? payload.exp * 1000 : null
  };
}

export { TOKEN_EXPIRY_SECONDS };
