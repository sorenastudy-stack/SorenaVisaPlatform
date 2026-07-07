import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { FinanceDashboardClient } from '@/components/staff/finance/FinanceDashboardClient';

// Finance portal — dashboard home. FINANCE + OWNER only (server-enforced here
// AND by the backend @StaffRoles guard on /staff/finance/*). Every other staff
// role bounces to /staff; clients never reach /staff at all (middleware).
const ALLOWED = new Set(['OWNER', 'FINANCE']);

export default async function FinanceDashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/finance');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <FinanceDashboardClient />;
}
