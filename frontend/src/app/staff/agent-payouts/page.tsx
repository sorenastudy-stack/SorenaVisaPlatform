import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { AgentPayoutsClient } from '@/components/staff/commissions/AgentPayoutsClient';

// PR-AGENT-PAYABLES (phase 2) — Finance's half: deciding whether a share is
// really owed. Same tier that runs the commission ledger these are derived
// from. The Owner's half lives at /staff/agent-payouts/release.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN', 'FINANCE']);

export default async function AgentPayoutsApprovePage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/agent-payouts');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <AgentPayoutsClient mode="approve" viewerId={session.userId} />;
}
