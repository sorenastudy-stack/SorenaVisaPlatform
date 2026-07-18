import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { StaffOverviewClient } from '@/components/staff/overview/StaffOverviewClient';

// Staff Overview — the real per-role landing. Admin tier gets the ops
// dashboard (case counts + attention worklist + recent activity); every other
// role gets a personalized launchpad. The client picks the mode from what the
// server returns (a 403 on the dashboard endpoint → launchpad), so entitlement
// stays enforced server-side.
//
// Finance portal — a FINANCE user's home is the Finance dashboard, not the
// general staff overview. Redirect them there (FINANCE-only; no other role is
// affected).
export default async function StaffOverviewPage() {
  const session = await getSession();
  if (session?.role === 'FINANCE') redirect('/staff/finance');
  return <StaffOverviewClient />;
}
