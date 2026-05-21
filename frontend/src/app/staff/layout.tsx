import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { StaffShell } from '@/components/staff/shell/StaffShell';

// PR-CONSULT-2 — `/staff/*` layout.
//
// Server-component cookie-bound auth check. The 7 staff roles are
// permitted; everyone else is bounced to /unauthorized. Inside the
// shell, the StaffProvider fetches /api/staff/me to populate the
// fine-grained permissions used by the sidebar + action buttons.
const STAFF_ROLES = new Set([
  'OWNER', 'SUPER_ADMIN', 'ADMIN',
  'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE',
]);

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff');
  if (!STAFF_ROLES.has(session.role)) redirect('/unauthorized');

  return <StaffShell>{children}</StaffShell>;
}
