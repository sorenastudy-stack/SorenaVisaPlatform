import { CaseDetailClient } from '@/components/staff/cases/detail/CaseDetailClient';

// PR-CONSULT-2 — Case detail page.
//
// Auth / role gating is handled by the parent /staff layout. The
// page hands the route param to the client component which owns
// the fetch + active tab state.
export default function StaffCaseDetailPage({ params }: { params: { id: string } }) {
  return <CaseDetailClient caseId={params.id} />;
}
