import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { HandoffsClient } from '@/components/staff/handoffs/HandoffsClient';

// PR-HANDOFFS — Owner-dashboard Handoffs section. OWNER / SUPER_ADMIN only, the
// same oversight tier as /admin/audit and the Compliance section.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN']);

export default async function StaffHandoffsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/handoffs');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <HandoffsClient />;
}
