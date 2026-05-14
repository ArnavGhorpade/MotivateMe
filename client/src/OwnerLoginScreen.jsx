import React, { useState } from 'react';
import { Bell, Loader2, Lock } from 'lucide-react';
import { useOwnerAuth } from './OwnerAuthContext.jsx';

export function OwnerLoginScreen() {
  const { signIn } = useOwnerAuth();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await signIn(password);
    } catch (err) {
      setError(err.message || 'Sign in failed.');
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen bg-slate-950 text-slate-100">
      <div className="absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.38),transparent_36%),linear-gradient(120deg,rgba(37,99,235,0.28),rgba(168,85,247,0.22),transparent_62%)]" />
      <section className="relative mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-12">
        <div className="grid h-12 w-12 place-items-center rounded-lg bg-white text-slate-950">
          <Bell size={22} />
        </div>
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-normal text-white">MotivateMe</h1>
          <p className="mt-2 text-sm text-slate-300">Private build. Enter the owner password to continue.</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="w-full rounded-lg border border-white/10 bg-white/[0.08] p-5 shadow-glow backdrop-blur"
        >
          <label className="field-label" htmlFor="owner-password">
            Password
          </label>
          <input
            id="owner-password"
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Owner password"
            autoComplete="current-password"
            className="field-input"
          />
          {error && (
            <div className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/15 px-3 py-2 text-sm text-rose-100">
              {error}
            </div>
          )}
          <button
            disabled={submitting}
            className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 font-semibold text-white shadow-lg shadow-blue-950/40 transition hover:scale-[1.01] hover:from-blue-400 hover:to-purple-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? <Loader2 className="animate-spin" size={19} /> : <Lock size={19} />}
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}
