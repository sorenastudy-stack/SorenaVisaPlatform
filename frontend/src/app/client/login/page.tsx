'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

// Client sign-in — passwordless magic-link. Distinct from the staff /login,
// and deliberately OUTSIDE /portal/* (that layout auth-gates + bounces logged-
// out visitors, so a login page can't live under it). Client accounts are
// auto-created (passwordless) when a visitor submits the readiness assessment,
// so they return via a one-time email link.
//
// The backend /auth/magic-link/request is anti-enumeration (always 200), so we
// always show the same "check your email" confirmation regardless of whether
// the address has an account.

export default function ClientLoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Friendly banner when a magic-link failed/expired (?error=… from the
  // backend verify redirect). Read via window (avoids a Suspense boundary).
  const [linkExpired, setLinkExpired] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('error')) setLinkExpired(true);
  }, []);

  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
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
            <form onSubmit={onSubmit} noValidate className="space-y-5">
              {linkExpired && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                  That sign-in link has expired or already been used. Enter your email and we&apos;ll send a fresh one.
                </div>
              )}
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

              <Button type="submit" size="lg" className="w-full mt-2" disabled={!valid || submitting}>
                {submitting ? 'Sending link…' : 'Email me a sign-in link'}
              </Button>
            </form>
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
