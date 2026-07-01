import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { StaffListClient } from '@/components/staff/team/StaffListClient';

// PR-BOOKING-ADMIN-A — Staff panel (list). Admin tier only; lower
// roles bounce to /staff. Thin server wrapper; the client owns state.
const ADMIN_TIER = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);

export default async function StaffTeamPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/team');
  if (!ADMIN_TIER.has(session.role)) redirect('/staff');
  return <StaffListClient />;
}
