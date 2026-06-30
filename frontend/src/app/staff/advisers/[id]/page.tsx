import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { AdviserEditClient } from '@/components/staff/advisers/AdviserEditClient';

// PR-BOOKING-ADMIN-A — Adviser edit. Admin tier only.
const ADMIN_TIER = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);

export default async function StaffAdviserEditPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/advisers');
  if (!ADMIN_TIER.has(session.role)) redirect('/staff');
  return <AdviserEditClient adviserId={params.id} />;
}
