import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { PortalLayout } from '@/components/portal/PortalLayout';

export default async function LiaLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/lia');
  if (!['LIA', 'SUPER_ADMIN', 'ADMIN'].includes(session.role)) redirect('/unauthorized');

  return (
    <PortalLayout portal="lia" session={session}>
      {children}
    </PortalLayout>
  );
}
