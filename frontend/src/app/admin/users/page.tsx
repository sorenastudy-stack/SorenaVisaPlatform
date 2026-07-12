import { redirect } from 'next/navigation';

// Staff user management lives in the staff portal (/staff/users), with the
// owner-approval flow at /staff/approvals. This was a "coming soon" stub
// duplicating it; forward rather than maintain a duplicate.
export default function AdminUsersPage() {
  redirect('/staff/users');
}
