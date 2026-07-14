import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ClientShell } from '@/components/portal/ClientShell';
import { getClientShellData } from '@/lib/clientShellData';

// Client portal — /portal/* layout (role-gated).
//
// Server-component cookie-bound role gate, mirroring /staff/layout.tsx.
// Only LEAD and STUDENT may enter. Anyone else (staff role, or missing
// session) is bounced before any portal content renders.
//
// UNIFIED CLIENT SHELL: renders the SAME ClientShell + the SAME sidebar as
// /student/* (resolved by getClientShellData) so a client never bounces between
// a short and a full sidebar. STUDENT clients get the fuller sidebar here too;
// LEAD clients get the reachable /portal subset. Piece #4 payment gating flows
// through unchanged (paymentUnlocked → lock icon; server 403s untouched).

const CLIENT_ROLES = new Set(['LEAD', 'STUDENT']);

export default async function ClientPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  // Path A: logged-out clients go to the CLIENT sign-in (magic link), never
  // the staff /login. Wrong-role (staff) still lands on /unauthorized.
  if (!session) redirect('/client/login');
  if (!CLIENT_ROLES.has(session.role)) redirect('/unauthorized');

  const { navItems, portalStage, paymentUnlocked } = await getClientShellData(session);

  return (
    <ClientShell
      session={session}
      portalStage={portalStage}
      navItems={navItems}
      paymentUnlocked={paymentUnlocked}
    >
      {children}
    </ClientShell>
  );
}
