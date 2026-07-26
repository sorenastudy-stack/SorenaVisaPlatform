import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { FollowUpsClient } from '@/components/staff/nurture/FollowUpsClient';

// PR-NURTURE — "My follow-ups": a Client Officer's open nurture call tasks
// (oldest-due first). Admin tier sees all. Same gate as the backend controller.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'CLIENT_CONSULTANT']);

export default async function StaffFollowUpsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/follow-ups');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <FollowUpsClient />;
}
