'use client';

import { useEffect, useState } from 'react';
import { routeForRole } from '@/lib/role-redirect';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

// Phase F — staff password RESET page (mirrors /set-password).
//
// The reset email links here with the raw token + email in the URL FRAGMENT
// (never sent to the server / access logs). On load we validate the token
// READ-ONLY (consumes nothing — scanner-safe); the single-use consume happens
// only when the user submits. On success the backend sets the new password +
// mints the JWT; the same-origin /api/auth/reset-password route sets the
// httpOnly session cookie and we hard-navigate via routeForRole. Failures
// bounce to the STAFF sign-in (/login).

type Status = 'checking' | 'valid' | 'invalid' | 'missing';

export default function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const p = new URLSearchParams(raw);
    const t = p.get('token') ?? '';
    const e = p.get('email') ?? '';
    setToken(t);
    setEmail(e);
    window.history.replaceState(null, '', window.location.pathname); // wipe token from history
    if (!t || !e) {
      setStatus('missing');
      return;
    }
    api
      .get(`/auth/password-reset/validate?token=${encodeURIComponent(t)}&email=${encodeURIComponent(e)}`)
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
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { role?: string; message?: string };
      if (!res.ok) {
        if (res.status === 401) {
          window.location.assign('/login?error=invalid_link');
          return;
        }
        setError(data?.message || 'Could not reset your password. Please try again.');
        setSubmitting(false);
        return;
      }
      window.location.assign(routeForRole(data.role, '/login'));
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
            <p className="mt-3 text-sm text-gray-500">Reset your password</p>
          </div>

          {status === 'checking' && <p className="text-center text-sm text-gray-500 py-6">Checking your link…</p>}

          {(status === 'missing' || status === 'invalid') && (
            <div className="text-center">
              <h1 className="text-lg font-bold text-[#1e3a5f] mb-2">This link can’t be used</h1>
              <p className="text-sm text-[#4A4A4A]/70 mb-6">
                {status === 'missing'
                  ? 'This reset link looks incomplete.'
                  : 'This reset link has expired or has already been used.'}{' '}
                Request a fresh one from the sign-in page.
              </p>
              <Button size="lg" className="w-full" onClick={() => window.location.assign('/forgot-password')}>
                Request a new link
              </Button>
            </div>
          )}

          {status === 'valid' && (
            <form onSubmit={onSubmit} noValidate className="space-y-5">
              <p className="text-sm text-[#4A4A4A]/70 leading-relaxed">
                Choose a new password for your Sorena Visa staff account
                {email ? <> (<span className="font-medium">{email}</span>)</> : null}.
              </p>
              <div>
                <label className="block text-sm font-semibold text-sorena-text mb-1.5">New password</label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" autoComplete="new-password" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-sorena-text mb-1.5">Confirm password</label>
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter your password" autoComplete="new-password" />
              </div>

              <ul className="text-xs text-[#4A4A4A]/70 space-y-1">
                <li className={longEnough ? 'text-emerald-600' : ''}>• At least 10 characters</li>
                <li className={hasLetter ? 'text-emerald-600' : ''}>• At least one letter</li>
                <li className={hasNumber ? 'text-emerald-600' : ''}>• At least one number</li>
                <li className={matches ? 'text-emerald-600' : ''}>• Both passwords match</li>
              </ul>

              {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

              <Button type="submit" size="lg" className="w-full mt-2" disabled={!canSubmit}>
                {submitting ? 'Resetting…' : 'Reset password & sign in'}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-white/40">
          <a href="/login" className="underline hover:text-white/70">Back to sign in</a>
        </p>
      </div>
    </div>
  );
}
