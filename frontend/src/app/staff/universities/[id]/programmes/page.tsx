import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ProgrammesCurationClient } from '@/components/staff/universities/ProgrammesCurationClient';

// PR-CURATION — the Owner's review screen for one institution's imported
// programmes: switch each Active/Inactive, correct any field, add a thumbnail.
//
// Same OWNER/SUPER_ADMIN gate as the institution screen it hangs off. The
// backend re-checks the role on every action; this redirect is the courtesy so
// staff never land on a page whose buttons would all fail.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN']);

export default async function ProgrammesCurationPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect(`/login?next=/staff/universities/${params.id}/programmes`);
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <ProgrammesCurationClient providerId={params.id} />;
}
