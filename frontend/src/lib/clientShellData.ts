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


// Last DEFINITIVE answer per user, used only when a later check fails.
//
// Deliberately not consulted on the happy path: a client who has just paid
// should see the gate open on their very next render, not after a TTL.
const ACCESS_CACHE = new Map<string, { paid: boolean; at: number }>();
const ACCESS_CACHE_TTL_MS = 10 * 60 * 1000;
const ACCESS_CACHE_MAX = 5_000;

async function resolvePaymentUnlocked(session: Session): Promise<boolean> {
  const key = session.userId ?? session.email ?? '';
  try {
    const a = await apiServer.get<{ paid: boolean }>('/portal/me/access');
    const paid = a.paid === true;
    if (key) {
      // Cheap bound: this is a fallback cache, not a store worth evicting well.
      if (ACCESS_CACHE.size >= ACCESS_CACHE_MAX) ACCESS_CACHE.clear();
      ACCESS_CACHE.set(key, { paid, at: Date.now() });
    }
    return paid;
  } catch {
    const cached = key ? ACCESS_CACHE.get(key) : undefined;
    if (cached && Date.now() - cached.at < ACCESS_CACHE_TTL_MS) return cached.paid;
    // Unknown. Render no locks rather than assert one we cannot substantiate;
    // the server-side guard still refuses the actual page.
    return true;
  }
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

  // Piece #4 payment gate — an ERROR now means "unknown", not "unpaid".
  //
  // This defaulted to locked on any failure. That reads like caution, but the
  // flag is PRESENTATION ONLY: EngagementPaidGuard re-checks the engagement
  // invoice from the database on every gated request and 403s independently of
  // anything decided here. So failing closed bought no security and cost real
  // harm — a transient error showed a client who HAD paid a row of padlocks on
  // features they own. Verified reproducible: once the shared rate limit
  // tripped, a paid client's nav rendered 5 locked items.
  //
  // On failure we therefore prefer the last definitive answer for this user,
  // and if there is none we decline to assert a lock at all. Claiming somebody
  // has not paid is a statement about their money; it should not be the thing
  // we guess when the network is unhappy.
  const paymentUnlocked = await resolvePaymentUnlocked(session);

  // LEAD (pre-promotion) — the reachable /portal subset. No /student links
  // (those are STUDENT-only in middleware and would dead-end for a LEAD).
  if (!isStudent) {
    const navItems: ClientNavItem[] = [
      { labelKey: 'portal.nav.myCase',    href: '/portal/case',           iconName: 'briefcase', exact: true },
      // Keyed via next-intl (PR-I18N-2: portal.nav.myAssessment / booking).
      // Persian is frozen; /portal/report already exists (404 → /portal/case).
      { labelKey: 'portal.nav.myAssessment', href: '/portal/report',      iconName: 'sparkles' },
      { labelKey: 'portal.nav.documents', href: '/portal/case/documents', iconName: 'fileText', lockedUntilPaid: true },
      // PR-PORTAL-PAYMENTS: LEAD-reachable Payments page (STUDENT nav already has
      // its own further down). Own-data-scoped server-side.
      { labelKey: 'portal.nav.payments',  href: '/portal/payments',       iconName: 'creditCard' },
      // Keyed via next-intl (PR-I18N-2: portal.nav.myAssessment / booking).
      // Bare /portal/booking = the standing chooser (all three types, always).
      { labelKey: 'portal.nav.booking',              href: '/portal/booking',        iconName: 'calendar' },
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
    // Keyed via next-intl (PR-I18N-2: portal.nav.myAssessment / booking).
    // Persian is frozen; /portal/report already exists (404 → /portal/case).
    { labelKey: 'portal.nav.myAssessment',        href: '/portal/report',         iconName: 'sparkles' },
    // PR-RECS-1 — programme matches (read-only list + sort). Inline English label
    // (no dot → literal, keeps Persian frozen). Payment-gated to match the endpoint.
    { labelKey: 'portal.nav.recommendations', href: '/student/recommendations', iconName: 'graduationCap', lockedUntilPaid: true },
    // PR-PHASE38 — the programme map/list. It was live and working but reachable
    // only by typing the URL; nothing in the portal linked to it. Sits next to
    // Recommendations because they answer the same question from two directions
    // (matched-for-you vs browse-everything), and carries the same
    // lockedUntilPaid gate so the whole post-payment group behaves alike.
    { labelKey: 'portal.nav.explore',   href: '/student/explore',         iconName: 'mapPin',        lockedUntilPaid: true },
    { labelKey: 'portal.nav.documents', href: '/portal/case/documents', iconName: 'fileText',      lockedUntilPaid: true },
    // Keyed via next-intl (PR-I18N-2: portal.nav.myAssessment / booking).
    { labelKey: 'portal.nav.booking',              href: '/portal/booking',        iconName: 'calendar' },
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
