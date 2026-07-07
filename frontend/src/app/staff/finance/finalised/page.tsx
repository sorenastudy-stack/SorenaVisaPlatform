import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { FinanceFinalisedClient } from '@/components/staff/finance/FinanceFinalisedClient';

// Finance portal — finalised (confirmed) payments ledger. FINANCE + OWNER only
// (server-enforced here AND by the backend @StaffRoles guard).
const ALLOWED = new Set(['OWNER', 'FINANCE']);

export default async function FinanceFinalisedPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/finance/finalised');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <FinanceFinalisedClient />;
}
