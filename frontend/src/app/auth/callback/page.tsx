'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { routeForRole } from '@/lib/role-redirect';

/**
 * Option C step 2 — Google OAuth callback landing page.
 *
 * Backend's /auth/google/callback 302s here with the JWT + role in
 * the URL fragment (fragments never reach server access logs). We:
 *   1. Parse the fragment.
 *   2. POST the token to /api/auth/google-session, which sets the
 *      same httpOnly cookie the password-login flow uses.
 *   3. Wipe the fragment from the address bar with replaceState.
 *   4. Redirect to the role's destination via ROLE_REDIRECT.
 *
 * Any failure (no token, route handler 4xx) bounces to
 * /login?error=not_authorized so the user gets a clear message.
 */

type Status = 'working' | 'error';

export default function GoogleCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('working');

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const rawHash = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(rawHash);
      const token = params.get('token');
      const role  = params.get('role');

      if (!token) {
        router.replace('/login?error=not_authorized');
        return;
      }

      let res: Response;
      try {
        res = await fetch('/api/auth/google-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
      } catch {
        if (!cancelled) setStatus('error');
        return;
      }

      if (!res.ok) {
        router.replace('/login?error=not_authorized');
        return;
      }

      // Cookie is set. Wipe the fragment from the address bar so the
      // token doesn't sit in browser history. (The fragment is also
      // not in any server log — this is purely cosmetic + defense
      // against accidental link-sharing.)
      try {
        window.history.replaceState({}, '', '/auth/callback');
      } catch { /* non-fatal */ }

      if (cancelled) return;
      router.replace(routeForRole(role));
    }

    void run();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-sorena-navy px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl px-8 py-10 text-center">
          <div className="flex justify-center mb-2">
            <img
              src="/brand/logo-type-blue.jpg"
              alt="Sorena Visa"
              className="h-12 w-auto"
            />
          </div>
          {status === 'working' ? (
            <p className="mt-6 text-sm text-gray-600">Signing you in…</p>
          ) : (
            <div className="mt-6 text-sm text-red-700">
              <p>Could not complete sign-in. Please try again.</p>
              <button
                onClick={() => router.replace('/login')}
                className="mt-4 text-sorena-navy underline"
              >
                Back to sign in
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
