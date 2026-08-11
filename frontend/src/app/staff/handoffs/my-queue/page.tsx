import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { MyQueueClient } from '@/components/staff/handoffs/MyQueueClient';

// PR-HANDOFF — cases handed to the signed-in user.
//
// No role list: the queue is scoped to the caller's own id server-side, so the
// answer for anyone with nothing waiting is an empty page rather than a denial.
// Any signed-in staff member can hold a stage, so any of them can receive one.
export default async function MyQueuePage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/handoffs/my-queue');
  return <MyQueueClient />;
}
