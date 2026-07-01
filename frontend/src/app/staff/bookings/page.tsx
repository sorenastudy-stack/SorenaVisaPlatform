import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { StaffBookingsClient } from '@/components/staff/bookings/StaffBookingsClient';

// PR-WALLET slice 2 — staff bookings (consultation list + No-Show/Completed/
// Cancel). Roles that run consultations + admin tier; others bounce to /staff.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT']);

export default async function StaffBookingsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/bookings');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <StaffBookingsClient />;
}
