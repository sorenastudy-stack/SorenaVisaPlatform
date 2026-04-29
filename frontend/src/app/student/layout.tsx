import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { PortalLayout } from '@/components/portal/PortalLayout';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/student');

  return (
    <PortalLayout portal="student" session={session}>
      {children}
    </PortalLayout>
  );
}
