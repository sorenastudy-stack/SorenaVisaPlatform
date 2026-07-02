'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Sparkles, Loader2, ArrowRight } from 'lucide-react';

// PR-CLIENT-STAGE — "promoted but stale" re-login prompt.
//
// Shown on the client portal home only when the server says the client is
// STAGE_2 (contract client+LIA signed → role promoted to STUDENT) but this
// browser's session cookie still holds the old LEAD role. The button clears
// the session cookie (existing POST /api/auth/logout) then sends them to
// /login, so they re-authenticate and receive a fresh token carrying the
// current DB role (STUDENT) — unlocking /student/*. No role guards change; no
// new backend; it just re-runs the normal, already-secured login path.

export function ReloginBanner() {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleReSignIn = async () => {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* non-fatal — the redirect below still drops them at /login */
    }
    router.push('/login');
  };

  return (
    <section className="rounded-2xl border border-[#F3CE49]/50 bg-[#1e3a5f] text-white px-5 py-5 md:px-6 md:py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Sparkles size={20} className="text-[#F3CE49] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-bold">{t('portal.relogin.title')}</p>
            <p className="mt-0.5 text-sm text-white/80">{t('portal.relogin.body')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleReSignIn}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-[#F3CE49] px-4 py-2.5 text-sm font-semibold text-[#1e3a5f] transition-colors hover:bg-[#F3CE49]/90 disabled:opacity-60 min-h-[44px]"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
          {t('portal.relogin.button')}
        </button>
      </div>
    </section>
  );
}
