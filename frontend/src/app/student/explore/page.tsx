import { ExploreClient } from '@/components/student/explore/ExploreClient';

// PR-EXPLORE — student programme map. The STUDENT role gate and shell come from
// /student/layout.tsx (same as recommendations); the backend enforces STUDENT
// independently on every /explore endpoint and scopes pricing to the
// authenticated student's nationality.
export default function StudentExplorePage() {
  return <ExploreClient />;
}
