// Module-level access token slot, shared between the AuthContext and the
// fetch helpers in main.jsx. Keeping this out of React state lets the api
// helpers stay as a plain object instead of a hook, which is the smallest
// possible diff against the existing codebase.

let accessToken = null;

export function setApiAccessToken(next) {
  accessToken = next ?? null;
}

export function authHeaders() {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}
