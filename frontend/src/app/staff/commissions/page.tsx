import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { CommissionsClient } from '@/components/staff/commissions/CommissionsClient';

// PR-COMMISSIONS-UI — institutional/provider commission ledger. OWNER + FINANCE
// (the money-managing tier) + SUPER_ADMIN. This is revenue Sorena EARNS from
// education providers after a student enrolls — NOT sales-rep payouts.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN', 'FINANCE']);

export default async function StaffCommissionsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/commissions');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <CommissionsClient role={session.role} />;
}
