import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { apiServer } from '@/lib/apiServer';
import {
  ConsultantMeetingsList,
  type ConsultantMeetingRow,
} from '@/components/consultant/meetings/ConsultantMeetingsList';

// PR-DASH-3 — Consultant meetings page.
//
// Server-component shell: cookie-bound auth check + role gate +
// a single GET to /api/consultant/meetings. Client component
// handles create/edit/cancel/complete actions via inline overlays.
const STAFF_ROLES = new Set([
  'SUPER_ADMIN', 'ADMIN', 'OPERATIONS', 'LIA', 'SUPPORT',
]);

export default async function ConsultantMeetingsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/consultant/meetings');
  if (!STAFF_ROLES.has(session.role)) redirect('/student');

  const meetings = await apiServer.get<ConsultantMeetingRow[]>('/api/consultant/meetings');

  return (
    <div className="min-h-screen bg-[#faf8f3]">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8 md:py-12">
        <ConsultantMeetingsList meetings={meetings ?? []} />
      </div>
    </div>
  );
}
