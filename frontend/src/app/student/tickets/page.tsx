import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { apiServer } from '@/lib/apiServer';
import { TicketList } from '@/components/tickets/TicketList';
import type { TicketRow } from '@/components/tickets/TicketListItem';

// PR-DASH-2 — Tickets list page.
//
// Server component: fetches the full list via apiServer.get and
// hands it to <TicketList>, which does client-side filtering and
// search. Locale-flat routing: lives at /student/tickets, not
// /[locale]/student/tickets.
export default async function StudentTicketsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/student/tickets');

  const tickets = await apiServer.get<TicketRow[]>('/students/me/tickets');

  return (
    <div className="min-h-screen bg-[#faf8f3]">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8 md:py-12">
        <TicketList tickets={tickets ?? []} />
      </div>
    </div>
  );
}
