// Phase 2 introduces these env-driven knobs. Defaults preserve the pre-Supabase
// behavior so local dev and CI keep working with no environment setup.

export const DATA_BACKEND = process.env.DATA_BACKEND || 'json';
export const AUTH_MODE = process.env.AUTH_MODE || 'off';

// Used by the JSON repo and the off-mode auth middleware so every task in
// json mode is owned by a single, deterministic synthetic user.
export const LOCAL_USER_ID = process.env.LOCAL_USER_ID || '00000000-0000-0000-0000-000000000000';

// Phase 3: Supabase wiring. Only required when DATA_BACKEND=supabase. The
// service-role key is server-only and must never be sent to the browser.
export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function validateBackendConfig() {
  if (DATA_BACKEND === 'supabase') {
    const missing = [];
    if (!SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (missing.length) {
      throw new Error(
        `DATA_BACKEND=supabase requires ${missing.join(', ')}. ` +
          `Set them in the environment or use DATA_BACKEND=json for local development.`
      );
    }
  } else if (DATA_BACKEND !== 'json') {
    throw new Error(
      `Unknown DATA_BACKEND="${DATA_BACKEND}". Expected "json" or "supabase".`
    );
  }
}
