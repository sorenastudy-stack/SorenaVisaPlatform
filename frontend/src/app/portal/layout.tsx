import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ClientPortalHeader } from '@/components/portal/ClientPortalHeader';

// Client portal step 3 — /portal/* layout (role-gated).
//
// Server-component cookie-bound role gate, mirroring /staff/layout.tsx.
// Only LEAD and STUDENT may enter. Anyone else (staff role, or missing
// session) is bounced before any portal content renders.
//
// We do NOT reuse the existing /student PortalLayout — that shell
// assumes the student data model (admission application, case-messages
// unread count, etc.) and pulls /students/me/* endpoints which return
// 403 for LEAD users.

const CLIENT_ROLES = new Set(['LEAD', 'STUDENT']);

export default async function ClientPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login?next=/portal');
  if (!CLIENT_ROLES.has(session.role)) redirect('/unauthorized');

  return (
    <div className="min-h-screen bg-[#faf8f3]">
      <ClientPortalHeader />
      <main className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-10">
        {children}
      </main>
    </div>
  );
}
