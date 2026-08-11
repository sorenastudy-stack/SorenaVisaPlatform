import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { RolesAccessClient } from '@/components/staff/roles/RolesAccessClient';

// PR-ROLES-REFERENCE — Roles & Access reference.
//
// OWNER/SUPER_ADMIN only, matching the backend gate on /staff/roles-access. The
// page is a complete map of the platform's permission surface: useful to
// whoever administers access, and not something to hand to everyone.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN']);

export default async function RolesAccessPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/roles');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <RolesAccessClient />;
}
