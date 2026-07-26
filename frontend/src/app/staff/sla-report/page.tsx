import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { SlaReportClient } from '@/components/staff/sla/SlaReportClient';

// PR-SLA — overdue cases grouped by Client Officer. OWNER / ADMIN / SUPER_ADMIN.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);

export default async function SlaReportPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/sla-report');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <SlaReportClient />;
}
