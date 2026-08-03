import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { AdmissionTasksClient } from '@/components/staff/admission-tasks/AdmissionTasksClient';

// PR-ADMISSION-TASKS-UI — "My admission tasks": the cross-case admission task queue (follow-ups +
// intake re-applications). Same gate as the backend controller.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'CLIENT_CONSULTANT']);

export default async function StaffAdmissionTasksPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/admission-tasks');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <AdmissionTasksClient />;
}
