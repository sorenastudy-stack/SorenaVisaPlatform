import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { apiServer } from '@/lib/apiServer';
import { MeetingsList } from '@/components/student/meetings/MeetingsList';
import type { MeetingRow } from '@/components/student/meetings/MeetingsList';

// PR-DASH-3 — Student meetings page.
//
// Server component shell: cookie-bound auth check, then a single
// GET to /api/student/meetings. Client component handles the
// overlay modal opens.
export default async function StudentMeetingsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/student/meetings');

  const meetings = await apiServer.get<MeetingRow[]>('/api/student/meetings');

  return (
    <div className="min-h-screen bg-[#faf8f3]">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8 md:py-12">
        <MeetingsList meetings={meetings ?? []} />
      </div>
    </div>
  );
}
