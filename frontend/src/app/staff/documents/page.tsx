import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { MyDocumentsClient } from '@/components/staff/documents/MyDocumentsClient';

// PR-STAFF-DOCS — "My case documents". Assignment-based: slot-holding roles +
// admin tier. Admin sees all; others see only their currently-assigned cases
// (enforced server-side). Non-eligible staff bounce to /staff.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE']);

export default async function StaffDocumentsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/documents');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <MyDocumentsClient />;
}
