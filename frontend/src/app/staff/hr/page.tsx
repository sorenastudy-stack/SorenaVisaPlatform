import { HrPageClient } from '@/components/staff/hr/HrPageClient';

// PR-STAFF-HR (Phase 3) — staff HR home (My Leave / My Contract / My Job
// Description). Open to every staff role; the /staff layout enforces
// staff-only access, and each tab is scoped server-side to the caller.
export default function StaffHrPage() {
  return <HrPageClient />;
}
