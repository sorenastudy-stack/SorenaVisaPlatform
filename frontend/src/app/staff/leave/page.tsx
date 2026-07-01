import { redirect } from 'next/navigation';

// PR-STAFF-HR (Phase 3) — "My leave" moved into the HR page as a tab.
// Keep this route as a permanent redirect so old links still work.
export default function StaffLeaveRedirect() {
  redirect('/staff/hr');
}
