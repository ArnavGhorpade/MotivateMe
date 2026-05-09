import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseAuthEnabled } from './supabaseClient.js';
import { setApiAccessToken } from './apiToken.js';

const AuthContext = createContext({
  session: null,
  user: null,
  accessToken: null,
  loading: false,
  authEnabled: false,
  signInWithMagicLink: async () => {},
  signOut: async () => {}
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  // Loading is only meaningful when auth is enabled. In off mode we never wait.
  const [loading, setLoading] = useState(isSupabaseAuthEnabled);

  useEffect(() => {
    if (!isSupabaseAuthEnabled || !supabase) {
      setApiAccessToken(null);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const next = data.session ?? null;
      setSession(next);
      setApiAccessToken(next?.access_token ?? null);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
      setApiAccessToken(nextSession?.access_token ?? null);
    });

    return () => {
      mounted = false;
      subscription?.subscription?.unsubscribe?.();
    };
  }, []);

  async function signInWithMagicLink(email) {
    if (!supabase) {
      throw new Error('Authentication is not configured for this build.');
    }
    const trimmed = (email || '').trim();
    if (!trimmed) {
      throw new Error('Enter the email you want to sign in with.');
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) {
      throw new Error(error.message);
    }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  const value = {
    session,
    user: session?.user ?? null,
    accessToken: session?.access_token ?? null,
    loading,
    authEnabled: isSupabaseAuthEnabled,
    signInWithMagicLink,
    signOut
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
