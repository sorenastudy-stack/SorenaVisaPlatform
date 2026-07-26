import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { KanbanClient } from '@/components/staff/kanban/KanbanClient';

// PR-CO-KANBAN — Client Officer daily task kanban. Client Officers + admin tier
// (who see all clients). Same gate as the backend controller.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'CLIENT_CONSULTANT']);

export default async function StaffKanbanPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/kanban');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <KanbanClient />;
}
