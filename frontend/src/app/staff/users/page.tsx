import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { StaffUsersPageClient } from '@/components/staff/users/StaffUsersPageClient';

// PR-CONSULT-3 — Staff Users page.
//
// Admin tier only. The page itself is a thin server-component
// wrapper; the client component owns filter state and overlay
// visibility. ADMIN reaches the page (read-only — write actions
// gated by canManageStaff at the component layer); lower roles
// redirected back to /staff.
const ADMIN_TIER = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);

export default async function StaffUsersPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/users');
  if (!ADMIN_TIER.has(session.role)) redirect('/staff');
  return <StaffUsersPageClient />;
}
