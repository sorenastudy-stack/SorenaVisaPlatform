import { CasesPageClient } from '@/components/staff/cases/CasesPageClient';

// PR-OPS-CASES — OPS "active cases" list. Reuses the staff cases list
// components; `activeOnly` restricts to in-flight cases and `basePath` routes
// row clicks to the OPS detail. `?stage=` (PR-OPS-DASHBOARD) deep-links from the
// dashboard count cards into a pre-filtered list. Role gating (OPERATIONS +
// admin tier) is handled by the /ops layout; the backend also gates the API.
export default function OpsCasesPage({
  searchParams,
}: {
  searchParams?: { stage?: string };
}) {
  return (
    <CasesPageClient
      activeOnly
      basePath="/ops/cases"
      initialStatus={searchParams?.stage ?? ''}
    />
  );
}
