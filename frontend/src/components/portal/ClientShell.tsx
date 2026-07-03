'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Briefcase, FileText, Wallet, MessageSquare,
  LayoutDashboard, ClipboardList, CreditCard, Plane,
  Menu, X, LogOut, Globe, ArrowLeft,
} from 'lucide-react';
import { Toaster } from 'sonner';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/lib/stores/localeStore';
import type { Session } from '@/lib/auth';
import { BackToTop } from '@/components/common/BackToTop';

// CLIENT-SHELL — the unified client navigation shell for /portal/* AND /student/*.
//
// A navy left sidebar (always visible on lg+, an overlay drawer on mobile) plus
// a white top header (hamburger, optional back, locale toggle, avatar, sign out).
// Structurally mirrors the shared staff PortalLayout so the client experience
// stops "jumping" between shells — but it is a SEPARATE component: it does not
// touch PortalLayout, so staff shells cannot regress.
//
// Data-driven nav (slice 2): callers may pass their own `navItems`; when omitted
// the built-in /portal config is used (so /portal is byte-for-byte unchanged).
// Icons are passed as a string `iconName` (mapped below) so a SERVER component
// (the student layout) can build nav data without shipping React elements.
//
// Nav visibility is UX only. Any link into a STUDENT-only route (e.g. the
// /student/* items, or the /portal "Messages" → /student/tickets) stays
// protected by middleware regardless of what the sidebar renders.
//
// RTL: the outer flex row and header clusters reverse automatically under
// document dir="rtl" (set by LocaleProvider), so the sidebar moves to the right
// with no extra classes. Only the absolutely-positioned mobile drawer needs
// explicit ltr:/rtl: side variants.

// Icon registry — keeps React elements inside this client component so nav
// data can cross the server→client boundary as plain strings.
const ICONS = {
  briefcase:     Briefcase,
  fileText:      FileText,
  wallet:        Wallet,
  messageSquare: MessageSquare,
  dashboard:     LayoutDashboard,
  clipboard:     ClipboardList,
  creditCard:    CreditCard,
  visa:          Plane,
} as const;

type IconName = keyof typeof ICONS;

// Guarantee an absolute nav target. A slash-less href (e.g. "student") would be
// resolved by <Link> RELATIVE to the current path — from /student/case that
// yields /student/student (a 404). Prefixing a leading slash makes every nav
// destination path-independent. Real URLs (/, http(s):, #, mailto:, tel:) pass
// through untouched.
function toAbsoluteHref(href: string): string {
  return /^(\/|https?:|#|mailto:|tel:)/.test(href) ? href : `/${href}`;
}

export interface ClientNavItem {
  labelKey:    string;
  href:        string;
  iconName:    IconName;
  exact?:      boolean;   // active-match: strict equality vs startsWith
  stage2Only?: boolean;   // (built-in /portal config) render only at STAGE_2
  badgeCount?: number;    // >0 renders a red unread dot
}

// Built-in /portal config — used when the caller passes no `navItems`.
// UNCHANGED from slice 1 (same items, order, exact flags, stage gating).
const PORTAL_NAV_ITEMS: ClientNavItem[] = [
  { labelKey: 'portal.nav.myCase',    href: '/portal/case',           iconName: 'briefcase', exact: true },
  { labelKey: 'portal.nav.documents', href: '/portal/case/documents', iconName: 'fileText' },
  { labelKey: 'portal.nav.wallet',    href: '/portal/wallet',         iconName: 'wallet' },
  // STAGE_2 only — links into the STUDENT-only tickets area (middleware-gated).
  { labelKey: 'portal.nav.messages',  href: '/student/tickets',       iconName: 'messageSquare', stage2Only: true },
];

interface ClientShellProps {
  children:     React.ReactNode;
  session:      Session;
  portalStage:  'STAGE_1' | 'STAGE_2';
  navItems?:    ClientNavItem[];  // omitted → built-in /portal config
  backHref?:    string;
  backLabelKey?: string;
}

export function ClientShell({ children, session, portalStage, navItems, backHref, backLabelKey }: ClientShellProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const router = useRouter();
  const { locale, toggleLocale } = useLocaleStore();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const items = (navItems ?? PORTAL_NAV_ITEMS).filter(
    (i) => !i.stage2Only || portalStage === 'STAGE_2',
  );

  const isActive = (item: ClientNavItem) => {
    const href = toAbsoluteHref(item.href);
    return item.exact ? pathname === href : pathname.startsWith(href);
  };

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* non-fatal — the redirect below still drops them at /login */
    }
    router.push('/login');
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-white/10 flex items-center gap-3">
        <img src="/brand/logo-mark-white.jpg" alt="Sorena" className="h-8 w-8 flex-shrink-0" />
        <div className="flex flex-col leading-tight">
          <span className="text-white font-extrabold text-sm tracking-tight">Sorena Visa</span>
          <span className="text-sorena-gold text-[10px] font-bold uppercase tracking-wider">
            {t('portal.headerTitle')}
          </span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {items.map((item) => {
          const active = isActive(item);
          const Icon = ICONS[item.iconName];
          const href = toAbsoluteHref(item.href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setDrawerOpen(false)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors min-h-[44px]',
                active
                  ? 'bg-white/15 text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon size={18} />
              <span className="flex-1">{t(item.labelKey)}</span>
              {item.badgeCount ? (
                <span
                  className="inline-block w-2 h-2 rounded-full bg-red-500"
                  aria-label={`${item.badgeCount} unread`}
                />
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Desktop sidebar — first flex child; flips to the right under dir=rtl. */}
      <aside className="hidden lg:flex w-64 flex-col flex-shrink-0 bg-sorena-navy">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 ltr:left-0 rtl:right-0 w-64 flex flex-col bg-sorena-navy z-50">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute top-4 ltr:right-4 rtl:left-4 text-white/70 hover:text-white min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <X size={20} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0">
        <header className="flex items-center justify-between h-14 px-4 bg-white border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="lg:hidden p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            {backHref && (
              <Link
                href={toAbsoluteHref(backHref)}
                className="inline-flex items-center gap-1.5 px-2 py-2 rounded-lg text-sm font-semibold text-sorena-navy hover:bg-gray-100 min-h-[44px]"
              >
                <ArrowLeft size={16} className="rtl:rotate-180" />
                <span className="hidden sm:inline">{backLabelKey ? t(backLabelKey) : t('portal.nav.back')}</span>
              </Link>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleLocale}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:bg-gray-100 transition-colors min-h-[40px]"
              title={locale === 'en' ? 'Switch to Persian' : 'Switch to English'}
            >
              <Globe size={14} />
              {locale === 'en' ? 'فا' : 'EN'}
            </button>

            <div className="flex items-center gap-2 ltr:pl-2 rtl:pr-2 ltr:border-l rtl:border-r border-gray-100">
              <div className="w-7 h-7 rounded-full bg-sorena-navy flex items-center justify-center text-white text-xs font-bold">
                {(session.name || session.email)?.[0]?.toUpperCase()}
              </div>
              <span className="text-sm text-gray-700 hidden sm:block max-w-[120px] truncate">
                {session.name || session.email}
              </span>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-gray-500 hover:text-sorena-navy hover:bg-gray-100 transition-colors min-h-[40px]"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">{t('portal.signOut')}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>

      <BackToTop />
      <Toaster richColors position="top-right" />
    </div>
  );
}
