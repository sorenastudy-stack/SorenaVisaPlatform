'use client';

import Link from 'next/link';
import { useEffect } from 'react';

// Client portal error boundary. Without this, a fault or stall in a
// /portal/* server render had no boundary to surface it — the failure
// was silent and the user (mid Google-login redirect) stayed frozen on
// the callback's "Signing you in…" forever. This makes any future
// failure visible and recoverable.

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the real cause in the browser console for diagnosis.
    console.error('Portal render error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-sorena-navy px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl px-8 py-10 text-center">
          <h1 className="text-lg font-bold text-sorena-navy">
            Something went wrong
          </h1>
          <p className="mt-3 text-sm text-gray-600">
            We couldn&apos;t load your portal. Please try again.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              onClick={() => reset()}
              className="text-sm font-semibold text-sorena-navy underline"
            >
              Try again
            </button>
            <Link
              href="/client/login"
              className="text-sm text-gray-500 underline hover:text-sorena-navy"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
