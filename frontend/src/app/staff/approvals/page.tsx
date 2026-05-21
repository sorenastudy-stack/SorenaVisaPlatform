import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ApprovalsPageClient } from '@/components/staff/approvals/ApprovalsPageClient';

// PR-CONSULT-3 — Approvals page.
//
// OWNER + SUPER_ADMIN only. OWNER lands on Pending by default;
// SUPER_ADMIN lands on My Requests. The "Sent for owner approval"
// toast deep-links to `?tab=mine` so a SUPER_ADMIN can verify
// their request landed.
const QUEUE_ROLES = new Set(['OWNER', 'SUPER_ADMIN']);

export default async function StaffApprovalsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/approvals');
  if (!QUEUE_ROLES.has(session.role)) redirect('/staff');
  return <ApprovalsPageClient />;
}
