import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { AgentPayoutsClient } from '@/components/staff/commissions/AgentPayoutsClient';

// PR-AGENT-PAYABLES (phase 2) — the Owner's half: releasing the money.
//
// The page is visible to the money tier so Finance can see what is waiting,
// but only the OWNER may actually release, and the server refuses a release by
// whoever approved the same row. The gate here is convenience; the boundary is
// in AgentPayablesService.release().
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN', 'FINANCE']);

export default async function AgentPayoutsReleasePage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/agent-payouts/release');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <AgentPayoutsClient mode="release" viewerId={session.userId} />;
}
