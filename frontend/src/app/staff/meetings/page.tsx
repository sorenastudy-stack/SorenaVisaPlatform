import { StaffMeetingsClient } from '@/components/staff/meetings/StaffMeetingsClient';

// Staff "My Meetings" — the signed-in staff member's own consultation sessions
// (upcoming + past), read-only, from GET /staff/bookings (server-scoped to the
// JWT user). Replaces the old placeholder.
export default function StaffMeetingsPage() {
  return <StaffMeetingsClient />;
}
