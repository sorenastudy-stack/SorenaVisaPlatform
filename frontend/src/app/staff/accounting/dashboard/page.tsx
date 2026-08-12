import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { AccountingDashboardClient } from '@/components/staff/accounting/AccountingDashboardClient';

// PR-ACCOUNTING-DASHBOARD — the accountant's front page.
//
// The spec named FINANCE_ADMIN; that role does not exist in this codebase. The
// real one is FINANCE — the role accounting@sorenavisa.com holds. Same trio the
// commission ledger and the finance portal already use, so a person who can see
// one can see all three.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN', 'FINANCE']);

export default async function AccountingDashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/accounting/dashboard');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  // The greeting names whoever is actually signed in — the client reads that
  // from /api/staff/me, because the session JWT carries no name.
  return <AccountingDashboardClient />;
}
