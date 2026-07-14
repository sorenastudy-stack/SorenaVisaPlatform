'use client';

import { useEffect, useState } from 'react';
import { routeForRole } from '@/lib/role-redirect';
import { Button } from '@/components/ui/Button';

// Two-step magic-link: the backend GET validated the token WITHOUT consuming
// it and redirected here with token+email in the URL fragment. The token is
// only consumed on the explicit "Sign in" POST below — email scanners issue
// GETs (which now just validate) but not this POST, so they can't burn the
// single-use link.
//
// On confirm: POST → /api/auth/magic-link/confirm (same-origin) consumes the
// token, mints the JWT, and sets the httpOnly sorena_session cookie. We then
// hard-navigate to the role's destination (LEAD → /portal/case). Any failure
// bounces to the client sign-in with a friendly message — never staff /login.

export default function MagicLinkConfirmPage() {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const raw = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const p = new URLSearchParams(raw);
    const t = p.get('token') ?? '';
    const e = p.get('email') ?? '';
    setToken(t);
    setEmail(e);
    if (!t || !e) setMissing(true);
    // Wipe the token out of the address bar / history.
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const confirm = async () => {
    if (!token || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/magic-link/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email }),
      });
      const data = (await res.json().catch(() => ({}))) as { role?: string };
      if (!res.ok) {
        window.location.assign('/client/login?error=invalid_link');
        return;
      }
      // Cookie is set by the route handler — hard-nav so the destination RSC
      // reads the fresh session.
      window.location.assign(routeForRole(data.role, '/portal/case'));
    } catch {
      window.location.assign('/client/login?error=invalid_link');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-sorena-navy px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl px-8 py-10 text-center">
          <div className="flex justify-center mb-4">
            <img src="/brand/logo-type-blue.jpg" alt="Sorena Visa" className="h-12 w-auto" />
          </div>
          {missing ? (
            <>
              <h1 className="text-lg font-bold text-[#1E3A5F] mb-2">Link incomplete</h1>
              <p className="text-sm text-[#4A4A4A]/70 mb-6">
                This sign-in link looks incomplete. Please request a new one.
              </p>
              <Button size="lg" className="w-full" onClick={() => window.location.assign('/client/login')}>
                Back to sign in
              </Button>
            </>
          ) : (
            <>
              <h1 className="text-lg font-bold text-[#1E3A5F] mb-2">Confirm sign-in</h1>
              <p className="text-sm text-[#4A4A4A]/70 mb-6">
                Click below to finish signing in to your Sorena account.
              </p>
              <Button size="lg" className="w-full" disabled={submitting} onClick={confirm}>
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
