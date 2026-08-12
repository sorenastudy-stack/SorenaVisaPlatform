import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { CommissionTriggersClient } from '@/components/staff/commissions/CommissionTriggersClient';

// PR-COMMISSION-TRIGGER — the Admission Officer's queue. Same role set as the
// sibling admission-milestone routes (offers, submissions), and deliberately NOT
// the commission-ledger set: claiming is not deciding.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT']);

export default async function CommissionTriggersPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/commission-triggers');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <CommissionTriggersClient />;
}
