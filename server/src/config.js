// Phase 2 introduces these env-driven knobs. Defaults preserve the pre-Supabase
// behavior so local dev and CI keep working with no environment setup.

export const DATA_BACKEND = process.env.DATA_BACKEND || 'json';
export const AUTH_MODE = process.env.AUTH_MODE || 'off';

// Used by the JSON repo and the off-mode auth middleware so every task in
// json mode is owned by a single, deterministic synthetic user.
export const LOCAL_USER_ID = process.env.LOCAL_USER_ID || '00000000-0000-0000-0000-000000000000';
