import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { PaymentsToConfirmClient } from '@/components/staff/payments/PaymentsToConfirmClient';

// Piece #3 — accountant "Payments to confirm" page. FINANCE + OWNER only
// (server-enforced here AND by the backend @StaffRoles guard). Every other
// staff role bounces to /staff; clients never reach /staff at all (middleware).
const ALLOWED = new Set(['OWNER', 'FINANCE']);

export default async function StaffPaymentsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/payments');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <PaymentsToConfirmClient />;
}
