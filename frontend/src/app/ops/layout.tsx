import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { PortalLayout } from '@/components/portal/PortalLayout';

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/ops');
  if (!['OPERATIONS', 'SUPER_ADMIN', 'ADMIN'].includes(session.role)) redirect('/unauthorized');

  return (
    <PortalLayout portal="ops" session={session}>
      {children}
    </PortalLayout>
  );
}
