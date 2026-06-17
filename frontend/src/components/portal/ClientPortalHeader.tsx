'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';

// Client portal step 3 — minimal navy header for the /portal/* shell.
//
// Sign-out mirrors the /unauthorized page's POST /api/auth/logout +
// router.push('/login') pattern so cookies are cleared server-side.

export function ClientPortalHeader() {
  const t = useTranslations();
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* non-fatal — the redirect below still drops them at /login */
    }
    router.push('/login');
  };

  return (
    <header className="bg-[#1e3a5f] text-white">
      <div className="mx-auto max-w-5xl px-4 py-4 md:px-6 flex items-center justify-between gap-3">
        <Link href="/portal/case" className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-wide">
            Sorena
          </span>
          <span className="text-xs text-[#c9a961] uppercase tracking-widest hidden sm:inline">
            {t('portal.headerTitle')}
          </span>
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white/90 hover:text-white border border-white/20 hover:bg-white/10 transition-colors min-h-[36px]"
        >
          <LogOut size={14} />
          {t('portal.signOut')}
        </button>
      </div>
    </header>
  );
}
