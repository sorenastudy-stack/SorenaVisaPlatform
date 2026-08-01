import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ProgrammeApprovalsClient } from '@/components/staff/programme-approvals/ProgrammeApprovalsClient';

// PR-CATALOG-1 — cross-institution pending-programme review queue. OWNER/SUPER_ADMIN
// only (the backend enforces the same on every endpoint).
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN']);

export default async function ProgrammeApprovalsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/programme-approvals');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <ProgrammeApprovalsClient />;
}
