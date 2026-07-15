'use client';

import { useEffect, useState } from 'react';
import { routeForRole } from '@/lib/role-redirect';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

// Client-onboarding: first-time "create your password" page.
//
// The onboarding email links here with the raw token + email in the URL
// FRAGMENT (never sent to the server / access logs, like the magic-link confirm
// page). On load we validate the token READ-ONLY (consumes nothing — scanner-
// safe); the single-use consume happens only when the user submits a password.
//
// On success the backend sets the FIRST password (never a reset) and mints the
// JWT; the same-origin /api/auth/set-password route sets the httpOnly
// sorena_session cookie and we hard-navigate to the portal (LEAD → /portal/case).
// Any token failure bounces to the CLIENT sign-in (magic-link), never staff.

type Status = 'checking' | 'valid' | 'invalid' | 'missing';

export default function SetPasswordPage() {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const raw = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const p = new URLSearchParams(raw);
    const t = p.get('token') ?? '';
    const e = p.get('email') ?? '';
    setToken(t);
    setEmail(e);
    // Wipe the token out of the address bar / history.
    window.history.replaceState(null, '', window.location.pathname);
    if (!t || !e) {
      setStatus('missing');
      return;
    }
    // Read-only validation — consumes nothing.
    api
      .get(`/auth/set-password/validate?token=${encodeURIComponent(t)}&email=${encodeURIComponent(e)}`)
      .then(() => setStatus('valid'))
      .catch(() => setStatus('invalid'));
  }, []);

  const longEnough = password.length >= 10;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const strongEnough = longEnough && hasLetter && hasNumber;
  const matches = password.length > 0 && password === confirm;
  const canSubmit = status === 'valid' && strongEnough && matches && !submitting;

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { role?: string; message?: string };
      if (!res.ok) {
        // 401 → token invalid/expired/replayed, or refused (account already has
        // a password). Send them to the client sign-in to use a magic link.
        if (res.status === 401) {
          window.location.assign('/client/login?error=invalid_link');
          return;
        }
        // 400 → password strength rejected server-side; show it inline.
        setError(data?.message || 'Could not set your password. Please try again.');
        setSubmitting(false);
        return;
      }
      // Cookie set by the route handler — hard-nav so the destination reads the
      // fresh session.
      window.location.assign(routeForRole(data.role, '/portal/case'));
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-sorena-navy px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl px-8 py-10">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-2">
              <img src="/brand/logo-type-blue.jpg" alt="Sorena Visa" className="h-12 w-auto" />
            </div>
            <p className="mt-3 text-sm text-gray-500">Create your password</p>
          </div>

          {status === 'checking' && (
            <p className="text-center text-sm text-gray-500 py-6">Checking your link…</p>
          )}

          {(status === 'missing' || status === 'invalid') && (
            <div className="text-center">
              <h1 className="text-lg font-bold text-[#1E3A5F] mb-2">This link can’t be used</h1>
              <p className="text-sm text-[#4A4A4A]/70 mb-6">
                {status === 'missing'
                  ? 'This set-up link looks incomplete.'
                  : 'This set-up link has expired or already been used.'}{' '}
                You can request a one-time sign-in link instead.
              </p>
              <Button size="lg" className="w-full" onClick={() => window.location.assign('/client/login')}>
                Go to sign in
              </Button>
            </div>
          )}

          {status === 'valid' && (
            <form onSubmit={onSubmit} noValidate className="space-y-5">
              <p className="text-sm text-[#4A4A4A]/70 leading-relaxed">
                Set a password to access your Sorena Visa Client Portal
                {email ? <> for <span className="font-medium">{email}</span></> : null}.
              </p>
              <div>
                <label className="block text-sm font-semibold text-sorena-text mb-1.5">New password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 10 characters"
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-sorena-text mb-1.5">Confirm password</label>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                />
              </div>

              <ul className="text-xs text-[#4A4A4A]/70 space-y-1">
                <li className={longEnough ? 'text-emerald-600' : ''}>• At least 10 characters</li>
                <li className={hasLetter ? 'text-emerald-600' : ''}>• At least one letter</li>
                <li className={hasNumber ? 'text-emerald-600' : ''}>• At least one number</li>
                <li className={matches ? 'text-emerald-600' : ''}>• Both passwords match</li>
              </ul>

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <Button type="submit" size="lg" className="w-full mt-2" disabled={!canSubmit}>
                {submitting ? 'Setting password…' : 'Create password & continue'}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-white/40">
          Prefer a one-time link?{' '}
          <a href="/client/login" className="underline hover:text-white/70">
            Request a magic link
          </a>
          .
        </p>
      </div>
    </div>
  );
}
