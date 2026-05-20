import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ChatLayout } from '@/components/student/chat/ChatLayout';

// PR-DASH-4 — Student chat page.
//
// Server-component shell with the cookie-bound auth check. All real
// work happens inside ChatLayout (client component) — it owns the
// conversation list state, the active thread, and the message send
// loop.
export default async function StudentChatPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/student/chat');

  return <ChatLayout />;
}
