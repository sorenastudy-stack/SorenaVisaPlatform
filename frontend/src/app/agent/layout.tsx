import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { AgentShell } from '@/components/agent/AgentShell';

// PR-AGENT-PORTAL phase 1 — the external agent's portal.
//
// AGENT only. Staff roles are deliberately NOT admitted: an Owner wanting to
// see an agent's view has the Owner-side agent screen, and letting staff in
// here would mean this surface had two kinds of caller with two meanings of
// "my clients".
//
// This redirect is convenience. The boundary is AgentAccessGuard on the API —
// every data route refuses a caller the gate has not cleared, whatever the
// browser was allowed to render.
export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/agent');
  if (session.role !== 'AGENT') redirect('/unauthorized');

  return <AgentShell>{children}</AgentShell>;
}
