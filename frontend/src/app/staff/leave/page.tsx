import { MyLeaveClient } from '@/components/staff/leave/MyLeaveClient';

// PR-BOOKING-ADMIN-B slice 2 — "My leave" self-service page. Open to every
// staff role; the /staff layout already enforces staff-only access.
export default function StaffMyLeavePage() {
  return <MyLeaveClient />;
}
