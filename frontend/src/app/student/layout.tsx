import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { ClientShell, type ClientNavItem } from '@/components/portal/ClientShell';

// Server-component role gate. Only STUDENT may enter /student/*.
// LEAD users go to /portal/* (different surface — see ROLE_REDIRECT).
// Staff users are redirected to /unauthorized rather than rendering
// the student shell and watching every /students/me/* fetch 403.
// Mirrors the /portal/layout.tsx pattern.
//
// CLIENT-SHELL slice 2: renders the SAME ClientShell as /portal (one
// consistent client shell everywhere) instead of the shared staff
// PortalLayout. Presentation only — the STUDENT gate below and the
// middleware /student gate are unchanged. The two fetches (hasCase,
// unread count) still drive the nav exactly as before.
const STUDENT_ROLES = new Set(['STUDENT']);

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/student');
  if (!STUDENT_ROLES.has(session.role)) redirect('/unauthorized');

  // correction 1: gate "Apply" nav item on case existence
  // GET returns 200 if contact+case exist (regardless of application state)
  // throws ApiServerError 404 if no Contact record (student has no case yet)
  let hasCase = false;
  try {
    await apiServer.get('/students/me/admission/application');
    hasCase = true;
  } catch (err) {
    if (!(err instanceof ApiServerError) || err.statusCode !== 404) {
      hasCase = true; // fail open on unexpected errors — don't hide Apply due to transient failures
    }
  }

  // PR-LIA-4: badge the Messages nav item if the LIA has unread
  // messages for this student. Fails open on any error (no badge).
  let studentUnreadMessages = 0;
  try {
    const res = await apiServer.get<{ count: number }>(
      '/students/me/case-messages/unread-count',
    );
    studentUnreadMessages = res?.count ?? 0;
  } catch {
    /* no badge if the lookup fails — non-fatal */
  }

  // STUDENT nav config. Cross-group items (Documents → /portal/case/documents,
  // Wallet → /portal/wallet) are reachable because the /portal gate is
  // LEAD+STUDENT. Apply is filtered out below when the student has no case.
  const navItems: ClientNavItem[] = [
    { labelKey: 'portal.nav.dashboard', href: '/student',               iconName: 'dashboard',     exact: true },
    { labelKey: 'portal.nav.myCase',    href: '/student/case',          iconName: 'briefcase',     exact: true },
    { labelKey: 'portal.nav.documents', href: '/portal/case/documents', iconName: 'fileText' },
    { labelKey: 'portal.nav.visa',      href: '/student/documents',     iconName: 'visa' },
    ...(hasCase
      ? [{ labelKey: 'portal.nav.apply', href: '/student/admission', iconName: 'clipboard' as const }]
      : []),
    { labelKey: 'portal.nav.payments',  href: '/student/payments',      iconName: 'creditCard' },
    { labelKey: 'portal.nav.messages',  href: '/student/case/messages', iconName: 'messageSquare', exact: true,
      badgeCount: studentUnreadMessages },
    { labelKey: 'portal.nav.wallet',    href: '/portal/wallet',         iconName: 'wallet' },
  ];

  return (
    <ClientShell session={session} portalStage="STAGE_2" navItems={navItems}>
      {children}
    </ClientShell>
  );
}
