import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { apiServer } from '@/lib/apiServer';
import { ClientShell } from '@/components/portal/ClientShell';

// Client portal step 3 — /portal/* layout (role-gated).
//
// Server-component cookie-bound role gate, mirroring /staff/layout.tsx.
// Only LEAD and STUDENT may enter. Anyone else (staff role, or missing
// session) is bounced before any portal content renders.
//
// CLIENT-SHELL slice 1: renders the unified ClientShell (navy sidebar +
// header) instead of the old top-only ClientPortalHeader. We still do NOT
// reuse the shared /student PortalLayout — that shell pulls /students/me/*
// endpoints which 403 for LEAD users. The shell's stage-gated "Messages"
// item is UX only; /student/tickets stays protected by middleware.

const CLIENT_ROLES = new Set(['LEAD', 'STUDENT']);

export default async function ClientPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login?next=/portal');
  if (!CLIENT_ROLES.has(session.role)) redirect('/unauthorized');

  // Stage signal for the shell's nav (STAGE_2 unlocks the Messages item).
  // Reuses the existing endpoint; defaults to STAGE_1 on any error so the
  // nav never over-exposes.
  let portalStage: 'STAGE_1' | 'STAGE_2' = 'STAGE_1';
  try {
    const s = await apiServer.get<{ portalStage: 'STAGE_1' | 'STAGE_2' }>('/portal/me/stage');
    portalStage = s.portalStage;
  } catch {
    /* default STAGE_1 */
  }

  return (
    <ClientShell session={session} portalStage={portalStage}>
      {children}
    </ClientShell>
  );
}
