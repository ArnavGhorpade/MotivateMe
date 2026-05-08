import { AUTH_MODE, LOCAL_USER_ID } from './config.js';

// In AUTH_MODE=off, every request is treated as the synthetic local user so
// the repo seam works identically to the pre-auth code path. Phase 5 will add
// the supabase branch that verifies a Bearer JWT and sets req.userId from
// auth.uid().
export function authMiddleware(req, res, next) {
  if (AUTH_MODE === 'off') {
    req.userId = LOCAL_USER_ID;
    return next();
  }
  return res.status(501).json({ error: `Auth mode "${AUTH_MODE}" not yet implemented.` });
}
