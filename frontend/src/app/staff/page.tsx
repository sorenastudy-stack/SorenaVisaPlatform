import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { PlaceholderPanel } from '@/components/staff/PlaceholderPanel';

// PR-CONSULT-2 — Staff Overview placeholder.
//
// The real overview (active workload, queues, recent activity per
// role) lands in a later PR. For now the page exists so post-login
// routing has somewhere to land and the shell renders.
//
// Finance portal — a FINANCE user's home is the Finance dashboard, not the
// general staff overview. Redirect them there (FINANCE-only; no other role is
// affected).
export default async function StaffOverviewPage() {
  const session = await getSession();
  if (session?.role === 'FINANCE') redirect('/staff/finance');
  return <PlaceholderPanel section="Overview" />;
}
