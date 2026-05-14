import React, { createContext, useContext, useEffect, useState } from 'react';
import { setOwnerAccessToken } from './apiToken.js';

const TOKEN_STORAGE_KEY = 'motivateme-owner-token';
const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');

const OwnerAuthContext = createContext({
  gateEnabled: false,
  authenticated: false,
  loading: true,
  accessToken: null,
  signIn: async () => {},
  signOut: () => {}
});

export function useOwnerAuth() {
  return useContext(OwnerAuthContext);
}

function readStoredToken() {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function writeStoredToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore — private mode, quota, etc.
  }
}

export function OwnerAuthProvider({ children }) {
  const [gateEnabled, setGateEnabled] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [accessToken, setAccessTokenState] = useState(null);
  const [loading, setLoading] = useState(true);

  function applyToken(next) {
    writeStoredToken(next);
    setOwnerAccessToken(next);
    setAccessTokenState(next);
  }

  useEffect(() => {
    const stored = readStoredToken();
    if (stored) {
      setOwnerAccessToken(stored);
      setAccessTokenState(stored);
    }

    let cancelled = false;
    fetch(`${API_BASE_URL}/api/session`, {
      headers: stored ? { Authorization: `Bearer ${stored}` } : {}
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          // Should not happen — /api/session is always 200 — but treat as
          // "gate likely on, no session" so the login screen is shown.
          setGateEnabled(true);
          setAuthenticated(false);
          applyToken(null);
          return;
        }
        const body = await res.json();
        const enabled = Boolean(body.ownerGateEnabled);
        setGateEnabled(enabled);
        if (!enabled) {
          // Dev mode without OWNER_APP_PASSWORD — drop any stale token.
          if (stored) applyToken(null);
          setAuthenticated(true);
          return;
        }
        if (body.authenticated) {
          setAuthenticated(true);
        } else {
          applyToken(null);
          setAuthenticated(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Network error on boot — assume the gate is on so we don't render
        // the app behind a broken connection.
        setGateEnabled(true);
        setAuthenticated(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function signIn(password) {
    const res = await fetch(`${API_BASE_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Sign in failed.');
    }
    const body = await res.json();
    if (!body?.token) {
      throw new Error('Sign in failed.');
    }
    applyToken(body.token);
    setAuthenticated(true);
  }

  function signOut() {
    applyToken(null);
    setAuthenticated(false);
  }

  const value = {
    gateEnabled,
    authenticated,
    loading,
    accessToken,
    signIn,
    signOut
  };

  return <OwnerAuthContext.Provider value={value}>{children}</OwnerAuthContext.Provider>;
}
