import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { PortalLayout } from '@/components/portal/PortalLayout';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/student');

  // correction 1: gate "Apply" nav item on case existence
  // GET returns 200 if contact+case exist (regardless of application state)
  // throws ApiServerError 404 if no Contact record (student has no case yet)
  let hasCase = false;
  try {
    await apiServer.get('/students/me/admission/application');
    hasCase = true;
  } catch (err) {
    if (!(err instanceof ApiServerError) || err.statusCode !== 404) {
      hasCase = true; // fail open on unexpected errors — don't hide Apply due to transient failures
    }
  }

  // PR-LIA-4: badge the Messages nav item if the LIA has unread
  // messages for this student. Fails open on any error (no badge).
  let studentUnreadMessages = 0;
  try {
    const res = await apiServer.get<{ count: number }>(
      '/students/me/case-messages/unread-count',
    );
    studentUnreadMessages = res?.count ?? 0;
  } catch {
    /* no badge if the lookup fails — non-fatal */
  }

  return (
    <PortalLayout
      portal="student"
      session={session}
      hasCase={hasCase}
      studentUnreadMessages={studentUnreadMessages}
    >
      {children}
    </PortalLayout>
  );
}
