import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { AdvisersListClient } from '@/components/staff/advisers/AdvisersListClient';

// PR-BOOKING-ADMIN-A — Advisers panel (list). Admin tier only; lower
// roles bounce to /staff. Thin server wrapper; the client owns state.
const ADMIN_TIER = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);

export default async function StaffAdvisersPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/advisers');
  if (!ADMIN_TIER.has(session.role)) redirect('/staff');
  return <AdvisersListClient />;
}
