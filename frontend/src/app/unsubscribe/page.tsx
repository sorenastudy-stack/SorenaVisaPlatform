'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

// PR-NURTURE — public unsubscribe confirmation page. The nurture/newsletter email
// footer links here with ?token=<per-lead token>. We show a confirm button and
// only POST on click — so an email-scanner prefetching the link can't silently
// unsubscribe someone. No auth: the token is the authorization.

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

function UnsubscribeInner() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  const submit = async () => {
    setState('busy');
    try {
      const res = await fetch(`${API_URL}/nurture/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  };

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FAF8F3', padding: 24 }}>
      <div style={{ maxWidth: 460, width: '100%', background: '#fff', borderRadius: 12, padding: 32, boxShadow: '0 1px 4px rgba(30,58,95,0.08)' }}>
        <h1 style={{ color: '#1E3A5F', fontSize: 22, fontWeight: 700, margin: '0 0 12px' }}>Unsubscribe from Sorena Visa emails</h1>

        {state === 'done' ? (
          <p style={{ color: '#4A4A4A', lineHeight: 1.6 }}>
            You’ve been unsubscribed. You won’t receive any more nurture or newsletter emails from us.
            If this was a mistake, just reply to any earlier email and we’ll help.
          </p>
        ) : state === 'error' ? (
          <p style={{ color: '#b4232a', lineHeight: 1.6 }}>
            This unsubscribe link is invalid or has expired. If you keep receiving emails you’d rather not,
            contact us and we’ll sort it out.
          </p>
        ) : (
          <>
            <p style={{ color: '#4A4A4A', lineHeight: 1.6, margin: '0 0 20px' }}>
              Click below to stop receiving nurture and newsletter emails from Sorena Visa. This won’t affect
              essential account emails.
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={state === 'busy' || !token}
              style={{
                background: '#1E3A5F', color: '#fff', border: 0, borderRadius: 8,
                padding: '13px 28px', fontSize: 15, fontWeight: 700,
                cursor: state === 'busy' || !token ? 'not-allowed' : 'pointer', opacity: state === 'busy' || !token ? 0.6 : 1,
              }}
            >
              {state === 'busy' ? 'Unsubscribing…' : 'Unsubscribe me'}
            </button>
            {!token && <p style={{ color: '#8B8B8B', fontSize: 13, marginTop: 12 }}>This link is missing its token.</p>}
          </>
        )}
      </div>
    </main>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <UnsubscribeInner />
    </Suspense>
  );
}
