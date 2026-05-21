import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { PlaceholderPanel } from '@/components/staff/PlaceholderPanel';

// PR-CONSULT-2 — Owner-approval queue placeholder.
//
// OWNER and SUPER_ADMIN can view this section; OWNER is the only
// role that can actually approve / reject queue items. Other roles
// get bounced to the staff overview rather than seeing an
// "Access Restricted" page.
const QUEUE_ROLES = new Set(['OWNER', 'SUPER_ADMIN']);

export default async function StaffApprovalsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/approvals');
  if (!QUEUE_ROLES.has(session.role)) redirect('/staff');
  return <PlaceholderPanel section="Approvals" />;
}
