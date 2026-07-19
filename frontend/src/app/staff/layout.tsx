import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { hasRole, STAFF_PORTAL_ROLES } from '@/lib/roles';
import { StaffShell } from '@/components/staff/shell/StaffShell';

// PR-CONSULT-2 / PR-STAFF-GATE-CONSISTENCY — `/staff/*` layout.
//
// Server-component cookie-bound auth check. Staff (by PRIMARY or SECONDARY role)
// are permitted; everyone else is bounced to /unauthorized. This uses the SAME
// shared STAFF_PORTAL_ROLES + hasRole widening as the edge middleware and the
// backend StaffRolesGuard, so all three /staff gates agree by construction (the
// old hand-copied Set checked the primary role only and omitted CLIENT_CONSULTANT,
// locking those users out). Inside the shell, StaffProvider fetches
// /api/staff/me to populate the fine-grained permissions.

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff');
  if (!hasRole(session.role, session.secondaryRoles, STAFF_PORTAL_ROLES)) {
    redirect('/unauthorized');
  }

  return <StaffShell>{children}</StaffShell>;
}
