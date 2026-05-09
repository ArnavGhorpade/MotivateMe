import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const authMode = (import.meta.env.VITE_AUTH_MODE || 'off').toLowerCase();

// Auth is enabled only when explicitly opted in AND both env vars are set.
// A misconfigured deploy (mode=supabase but missing keys) falls back to off
// with a console warning so local dev keeps working without a Supabase project.
const wantsSupabase = authMode === 'supabase';
const hasCredentials = Boolean(url) && Boolean(anonKey);

if (wantsSupabase && !hasCredentials) {
  // eslint-disable-next-line no-console
  console.warn(
    'VITE_AUTH_MODE=supabase requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. ' +
      'Falling back to unauthenticated mode.'
  );
}

export const isSupabaseAuthEnabled = wantsSupabase && hasCredentials;

export const supabase = isSupabaseAuthEnabled
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'motivateme-auth'
      }
    })
  : null;
