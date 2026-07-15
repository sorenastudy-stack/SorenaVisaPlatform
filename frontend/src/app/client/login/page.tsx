'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { routeForRole } from '@/lib/role-redirect';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

// Client sign-in — supports BOTH email+password (primary) and passwordless
// magic-link (secondary). Distinct from the staff /login, and deliberately
// OUTSIDE /portal/* (that layout auth-gates + bounces logged-out visitors).
//
// New clients set a password via the onboarding email (/set-password), then
// return here with email+password. Clients who never set one (or forget it)
// use "Email me a magic link". The magic-link request is anti-enumeration
// (always 200), so the confirmation copy is identical regardless of account.

type Mode = 'password' | 'magic';

export default function ClientLoginPage() {
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false); // magic-link "check your email"
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Friendly banner when a magic/set-up link failed/expired (?error=…).
  const [linkExpired, setLinkExpired] = useState(false);
  // Preserve ?next= across sign-in (validated same-origin path only).
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) setLinkExpired(true);
    const n = params.get('next');
    if (n && n.startsWith('/') && !n.startsWith('//')) setNext(n);
  }, []);

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  const onPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailValid || !password || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = (await res.json().catch(() => ({}))) as { role?: string; message?: string };
      if (!res.ok) {
        setError('Incorrect email or password. If you haven’t set a password yet, use a magic link below.');
        setSubmitting(false);
        return;
      }
      // Cookie set by the route handler — hard-nav so the destination reads it.
      window.location.assign(next ?? routeForRole(data.role, '/portal/case'));
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  const onMagicSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailValid || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await api.post('/auth/magic-link/request', { email: email.trim() });
      setSent(true);
    } catch {
      setError('Something went wrong sending your link. Please try again.');
    } finally {
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
            <p className="mt-3 text-sm text-gray-500">Sign in to your Sorena account</p>
          </div>

          {sent ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-4 text-sm text-emerald-800 text-center">
              <p className="font-semibold mb-1">Check your email</p>
              <p className="leading-relaxed">
                If an account exists for <span className="font-medium">{email.trim()}</span>, we&apos;ve
                sent a secure sign-in link. Open it on this device to continue.
              </p>
            </div>
          ) : (
            <>
              {linkExpired && (
                <div className="mb-5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                  That link has expired or already been used. Sign in with your password, or request a fresh magic link.
                </div>
              )}

              {mode === 'password' ? (
                <form onSubmit={onPasswordSubmit} noValidate className="space-y-5">
                  <div>
                    <label className="block text-sm font-semibold text-sorena-text mb-1.5">Email address</label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-sorena-text mb-1.5">Password</label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Your password"
                      autoComplete="current-password"
                    />
                  </div>

                  {error && (
                    <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                      {error}
                    </div>
                  )}

                  <Button type="submit" size="lg" className="w-full mt-2" disabled={!emailValid || !password || submitting}>
                    {submitting ? 'Signing in…' : 'Sign in'}
                  </Button>

                  <p className="text-center text-sm text-[#4A4A4A]/70">
                    <button
                      type="button"
                      onClick={() => { setMode('magic'); setError(''); }}
                      className="font-semibold text-sorena-navy underline underline-offset-4 hover:text-[#b8941f]"
                    >
                      Email me a magic link instead
                    </button>
                  </p>
                </form>
              ) : (
                <form onSubmit={onMagicSubmit} noValidate className="space-y-5">
                  <p className="text-sm text-[#4A4A4A]/70 leading-relaxed">
                    Enter your email and we&apos;ll send you a one-time link to sign in — no password needed.
                  </p>
                  <div>
                    <label className="block text-sm font-semibold text-sorena-text mb-1.5">Email address</label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                  </div>

                  {error && (
                    <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                      {error}
                    </div>
                  )}

                  <Button type="submit" size="lg" className="w-full mt-2" disabled={!emailValid || submitting}>
                    {submitting ? 'Sending link…' : 'Email me a sign-in link'}
                  </Button>

                  <p className="text-center text-sm text-[#4A4A4A]/70">
                    <button
                      type="button"
                      onClick={() => { setMode('password'); setError(''); }}
                      className="font-semibold text-sorena-navy underline underline-offset-4 hover:text-[#b8941f]"
                    >
                      Sign in with a password instead
                    </button>
                  </p>
                </form>
              )}
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-white/40">
          New here? Start with the{' '}
          <a href="/scorecard/landing" className="underline hover:text-white/70">
            free readiness assessment
          </a>
          .
        </p>
      </div>
    </div>
  );
}
