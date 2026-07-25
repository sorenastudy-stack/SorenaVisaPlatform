import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ComplianceClient } from '@/components/staff/compliance/ComplianceClient';

// PR-COMPLIANCE — Owner-dashboard Compliance section. OWNER / SUPER_ADMIN only
// (the Operations Manual's Compliance-Admin tier, same gate as /admin/audit).
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN']);

export default async function StaffCompliancePage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/compliance');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <ComplianceClient />;
}
