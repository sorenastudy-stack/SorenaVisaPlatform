import { apiServer, ApiServerError } from '@/lib/apiServer';
import type { Session } from '@/lib/auth';
import type { ClientNavItem } from '@/components/portal/ClientShell';

// Unified client-shell data resolver (server-side).
//
// Both /portal/* AND /student/* layouts call this so the client sees ONE
// consistent sidebar everywhere — no more bouncing between a short (/portal)
// and a full (/student) nav. The FULLER sidebar is canonical for STUDENT
// clients (who can reach the /student surfaces); a LEAD (pre-promotion) gets
// the working /portal subset so no nav link dead-ends at /unauthorized.
//
// Piece #4 payment gate is preserved: `paymentUnlocked` drives the lock icon on
// gated items (Documents / Visa application / Apply-Study), and the server-side
// 403s are untouched — this module is presentation only.

export interface ClientShellData {
  navItems: ClientNavItem[];
  portalStage: 'STAGE_1' | 'STAGE_2';
  paymentUnlocked: boolean;
}

export async function getClientShellData(session: Session): Promise<ClientShellData> {
  const isStudent = session.role === 'STUDENT';

  // Stage signal (STAGE_2 gating for any stage2Only items). Fail-safe STAGE_1.
  let portalStage: 'STAGE_1' | 'STAGE_2' = 'STAGE_1';
  try {
    const s = await apiServer.get<{ portalStage: 'STAGE_1' | 'STAGE_2' }>('/portal/me/stage');
    portalStage = s.portalStage;
  } catch {
    /* default STAGE_1 — never over-expose */
  }

  // Piece #4 payment gate. Fail-safe: locked (so nav never hides the lock).
  let paymentUnlocked = false;
  try {
    const a = await apiServer.get<{ paid: boolean }>('/portal/me/access');
    paymentUnlocked = a.paid === true;
  } catch {
    /* default locked */
  }

  // LEAD (pre-promotion) — the reachable /portal subset. No /student links
  // (those are STUDENT-only in middleware and would dead-end for a LEAD).
  if (!isStudent) {
    const navItems: ClientNavItem[] = [
      { labelKey: 'portal.nav.myCase',    href: '/portal/case',           iconName: 'briefcase', exact: true },
      { labelKey: 'portal.nav.documents', href: '/portal/case/documents', iconName: 'fileText', lockedUntilPaid: true },
      { labelKey: 'portal.nav.wallet',    href: '/portal/wallet',         iconName: 'wallet' },
    ];
    return { navItems, portalStage, paymentUnlocked };
  }

  // STUDENT — the fuller unified sidebar, shown identically on EVERY client
  // page (both /student/* and /portal/* routes).

  // "Apply / Study" only when the student actually has a case. Uses the
  // always-allowed /portal/me/case (NOT the payment-gated admission endpoint),
  // so the check is clean regardless of gate state. Fail-open on non-404.
  let hasCase = false;
  try {
    await apiServer.get('/portal/me/case');
    hasCase = true;
  } catch (err) {
    if (!(err instanceof ApiServerError) || err.statusCode !== 404) hasCase = true;
  }

  // Unread badge on Messages. Non-gated endpoint; fails open to no badge.
  let unread = 0;
  try {
    const res = await apiServer.get<{ count: number }>('/students/me/case-messages/unread-count');
    unread = res?.count ?? 0;
  } catch {
    /* no badge on error */
  }

  const navItems: ClientNavItem[] = [
    { labelKey: 'portal.nav.dashboard', href: '/student',               iconName: 'dashboard',     exact: true },
    { labelKey: 'portal.nav.myCase',    href: '/student/case',          iconName: 'briefcase',     exact: true },
    { labelKey: 'portal.nav.documents', href: '/portal/case/documents', iconName: 'fileText',      lockedUntilPaid: true },
    { labelKey: 'portal.nav.visa',      href: '/student/documents',     iconName: 'visa',          lockedUntilPaid: true },
    ...(hasCase
      ? [{ labelKey: 'portal.nav.apply', href: '/student/admission', iconName: 'clipboard' as const, lockedUntilPaid: true }]
      : []),
    { labelKey: 'portal.nav.payments',  href: '/student/payments',      iconName: 'creditCard' },
    { labelKey: 'portal.nav.messages',  href: '/student/case/messages', iconName: 'messageSquare', exact: true, badgeCount: unread },
    { labelKey: 'portal.nav.wallet',    href: '/portal/wallet',         iconName: 'wallet' },
  ];

  return { navItems, portalStage, paymentUnlocked };
}
