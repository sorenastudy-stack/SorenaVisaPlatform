import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { PlaceholderPanel } from '@/components/staff/PlaceholderPanel';

// PR-CONSULT-2 — Staff CRUD placeholder.
//
// Server-side role check on top of the StaffShell layout's check
// because this section is admin-tier only. Non-admin staff see the
// /staff overview instead of "Access Restricted" so the navigation
// fails gracefully if someone shares a deep link.
const ADMIN_TIER = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);

export default async function StaffUsersPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/users');
  if (!ADMIN_TIER.has(session.role)) redirect('/staff');
  return <PlaceholderPanel section="Staff" />;
}
