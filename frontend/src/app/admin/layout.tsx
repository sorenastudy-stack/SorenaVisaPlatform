import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { PortalLayout } from '@/components/portal/PortalLayout';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin');
  if (!['ADMIN', 'SUPER_ADMIN'].includes(session.role)) redirect('/unauthorized');

  return (
    <PortalLayout portal="admin" session={session}>
      {children}
    </PortalLayout>
  );
}
