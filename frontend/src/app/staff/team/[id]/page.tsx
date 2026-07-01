import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { StaffEditClient } from '@/components/staff/team/StaffEditClient';

// PR-BOOKING-ADMIN-A — Staff member edit. Admin tier only.
const ADMIN_TIER = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);

export default async function StaffTeamEditPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/team');
  if (!ADMIN_TIER.has(session.role)) redirect('/staff');
  return <StaffEditClient staffId={params.id} />;
}
