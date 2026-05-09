// Phase 2 introduces these env-driven knobs. Defaults preserve the pre-Supabase
// behavior so local dev and CI keep working with no environment setup.
//
// The static exports below are convenience for module-load-time consumers
// (e.g. supabaseRepo.js when constructed). The auth middleware and validators
// re-read process.env at call time so tests can flip mode without juggling
// dynamic imports — production behavior is identical because env vars don't
// change after startup.

export const DEFAULT_LOCAL_USER_ID = '00000000-0000-0000-0000-000000000000';

export const DATA_BACKEND = (process.env.DATA_BACKEND || 'json').toLowerCase();
export const AUTH_MODE = (process.env.AUTH_MODE || 'off').toLowerCase();

// Used by the JSON repo and the off-mode auth middleware so every task in
// json mode is owned by a single, deterministic synthetic user.
export const LOCAL_USER_ID = process.env.LOCAL_USER_ID || DEFAULT_LOCAL_USER_ID;

// Phase 3: Supabase wiring. Only required when DATA_BACKEND=supabase. The
// service-role key is server-only and must never be sent to the browser.
export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Phase 5: Supabase JWT verification. Required only when AUTH_MODE=supabase.
// Used to verify HS256 signatures of incoming Bearer tokens.
export const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';

export function validateBackendConfig() {
  const backend = (process.env.DATA_BACKEND || 'json').toLowerCase();
  if (backend === 'supabase') {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const missing = [];
    if (!url) missing.push('SUPABASE_URL');
    if (!key) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (missing.length) {
      throw new Error(
        `DATA_BACKEND=supabase requires ${missing.join(', ')}. ` +
          `Set them in the environment or use DATA_BACKEND=json for local development.`
      );
    }
  } else if (backend !== 'json') {
    throw new Error(
      `Unknown DATA_BACKEND="${backend}". Expected "json" or "supabase".`
    );
  }
}

export function validateAuthConfig() {
  const mode = (process.env.AUTH_MODE || 'off').toLowerCase();
  if (mode === 'supabase') {
    const secret = process.env.SUPABASE_JWT_SECRET || '';
    if (!secret) {
      throw new Error(
        'AUTH_MODE=supabase requires SUPABASE_JWT_SECRET. ' +
          'Set it in the environment or use AUTH_MODE=off for local development.'
      );
    }
  } else if (mode !== 'off') {
    throw new Error(
      `Unknown AUTH_MODE="${mode}". Expected "off" or "supabase".`
    );
  }
}
