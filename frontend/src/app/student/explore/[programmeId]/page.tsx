import { ProgrammeDetailClient } from '@/components/student/explore/ProgrammeDetailClient';

// PR-EXPLORE — one programme in full. STUDENT gate comes from /student/layout.tsx;
// the backend 404s any programme that is not student-visible, so an unapproved
// programme cannot be probed by guessing its id.
export default function ProgrammeDetailPage({ params }: { params: { programmeId: string } }) {
  return <ProgrammeDetailClient programmeId={params.programmeId} />;
}
