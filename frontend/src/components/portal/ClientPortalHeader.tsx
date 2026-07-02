'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';

// Client portal step 3 — navy header for the /portal/* shell.
//
// Top row: brand (left) + Sign out (right). Below it, a horizontal nav so a
// client can reach every real page (My Case / Documents / Wallet) from
// anywhere — booking is intentionally omitted (it's entered contextually from
// the case page with a ?type=, and bare /portal/booking is a placeholder).
//
// Sign-out mirrors the /unauthorized page's POST /api/auth/logout +
// router.push('/login') pattern so cookies are cleared server-side.

// Real client pages only. `exact` on My Case so it isn't marked active while
// on /portal/case/documents (which is a sub-path).
const NAV_ITEMS: Array<{ href: string; labelKey: string; exact?: boolean }> = [
  { href: '/portal/case',            labelKey: 'portal.nav.myCase', exact: true },
  { href: '/portal/case/documents',  labelKey: 'portal.nav.documents' },
  { href: '/portal/wallet',          labelKey: 'portal.nav.wallet' },
];

export function ClientPortalHeader() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();

  const isActive = (item: (typeof NAV_ITEMS)[number]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

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
      <div className="mx-auto max-w-5xl px-4 pt-4 md:px-6 flex items-center justify-between gap-3">
        <Link href="/portal/case" className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-wide">
            Sorena
          </span>
          <span className="text-xs text-[#b8941f] uppercase tracking-widest hidden sm:inline">
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

      {/* Client navigation — horizontal, wraps on small screens. */}
      <nav className="mx-auto max-w-5xl px-4 md:px-6">
        <ul className="flex flex-wrap gap-1 pt-3">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'inline-flex items-center px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors min-h-[40px]',
                    active
                      ? 'border-[#F3CE49] text-white'
                      : 'border-transparent text-white/60 hover:text-white',
                  ].join(' ')}
                >
                  {t(item.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
