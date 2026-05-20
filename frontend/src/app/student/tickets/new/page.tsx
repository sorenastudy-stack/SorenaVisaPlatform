import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { NewTicketForm } from '@/components/tickets/NewTicketForm';

// PR-DASH-2 — New-ticket page.
//
// Plain wrapper around the client-side NewTicketForm. Auth check
// runs server-side so an unauthenticated visit bounces to /login
// with a next param that lands them back here after sign-in.
export default async function NewTicketPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/student/tickets/new');

  return (
    <div className="min-h-screen bg-[#faf8f3]">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 md:px-8 md:py-12">
        <NewTicketForm />
      </div>
    </div>
  );
}
