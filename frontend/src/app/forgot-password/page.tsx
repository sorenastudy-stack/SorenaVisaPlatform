'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

// Phase F — staff "Forgot password?" request page. Enter email → the backend
// emails a reset link (anti-enumeration: the response is identical whether or
// not the account exists). Rate-limited server-side.

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://api.sorenavisa.com';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      // Direct backend call (no cookie needed). The response is generic either
      // way, so we show the same confirmation regardless.
      await fetch(`${BACKEND_URL}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      setSent(true);
    } catch {
      // Even on a network error we don't reveal account state; a rate-limit
      // (429) also lands here — show the generic confirmation.
      setSent(true);
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
            <p className="mt-3 text-sm text-gray-500">Reset your password</p>
          </div>

          {sent ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sorena-gold/15">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c9a961" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4z" /><path d="m22 6-10 7L2 6" /></svg>
              </div>
              <h1 className="text-lg font-bold text-[#1e3a5f] mb-2">Check your email</h1>
              <p className="text-sm text-[#4A4A4A]/70 mb-6">
                If that email is registered, we&apos;ve sent a password reset link. It expires in 30 minutes and can be used once.
              </p>
              <Button size="lg" className="w-full" onClick={() => window.location.assign('/login')}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate className="space-y-5">
              <p className="text-sm text-[#4A4A4A]/70 leading-relaxed">
                Enter your staff email and we&apos;ll send you a link to set a new password.
              </p>
              <div>
                <label className="block text-sm font-semibold text-sorena-text mb-1.5">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@sorenavisa.com"
                  autoComplete="email"
                />
              </div>
              {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
              <Button type="submit" size="lg" className="w-full" disabled={!email.trim() || submitting}>
                {submitting ? 'Sending…' : 'Send reset link'}
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
