// Two independent token slots so the owner gate and Supabase auth never
// clobber each other's state. authHeaders() returns the owner token first
// when present (the deployed build runs behind the owner gate); Supabase
// tokens are used only when the owner gate is disabled and Supabase auth is
// enabled. In practice exactly one slot is populated at a time, but the
// strict precedence keeps the wire format predictable if both ever line up.

let ownerToken = null;
let supabaseToken = null;

export function setOwnerAccessToken(next) {
  ownerToken = next ?? null;
}

export function setSupabaseAccessToken(next) {
  supabaseToken = next ?? null;
}

export function authHeaders() {
  const token = ownerToken || supabaseToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
