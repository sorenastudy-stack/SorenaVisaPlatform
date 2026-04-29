import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { PortalLayout } from '@/components/portal/PortalLayout';

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/sales');
  if (!['SALES', 'SUPER_ADMIN', 'ADMIN'].includes(session.role)) redirect('/unauthorized');

  return (
    <PortalLayout portal="sales" session={session}>
      {children}
    </PortalLayout>
  );
}
