import { RecommendationsClient } from '@/components/student/recommendations/RecommendationsClient';

// PR-RECS-1 (slice 1) — student programme-matches page. Read-only: view + sort.
// STUDENT role gate + shell come from /student/layout.tsx; the backend endpoints
// enforce STUDENT + engagement-paid independently. No slot selection (slice 2).
export default function StudentRecommendationsPage() {
  return <RecommendationsClient />;
}
