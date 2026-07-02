import { CaseDetailClient } from '@/components/staff/cases/detail/CaseDetailClient';

// PR-OPS-CASES — OPS case detail. Reuses the staff case detail component with
// `canEdit` (OPS may update stage/notes). The Reassign button auto-hides under
// /ops (no StaffProvider → canReassign false); risk/legal actions live in the
// LIA portal, not here. Role gating is handled by the /ops layout.
export default function OpsCaseDetailPage({ params }: { params: { id: string } }) {
  return <CaseDetailClient caseId={params.id} canEdit />;
}
