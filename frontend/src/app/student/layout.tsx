import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ClientShell } from '@/components/portal/ClientShell';
import { getClientShellData } from '@/lib/clientShellData';

// Client portal — /student/* layout (role-gated).
//
// Server-component role gate. Only STUDENT may enter /student/*. LEAD users
// go to /portal/*; staff are redirected to /unauthorized.
//
// UNIFIED CLIENT SHELL: renders the SAME ClientShell + the SAME fuller sidebar
// as /portal/* (resolved by getClientShellData) — one consistent client shell
// on every page, no bounce. Piece #4 payment gating flows through unchanged.

const STUDENT_ROLES = new Set(['STUDENT']);

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/student');
  if (!STUDENT_ROLES.has(session.role)) redirect('/unauthorized');

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
