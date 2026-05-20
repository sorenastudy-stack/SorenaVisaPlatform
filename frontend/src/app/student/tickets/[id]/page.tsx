import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { TicketDetail, type TicketDetailData } from '@/components/tickets/TicketDetail';

// PR-DASH-2 — Single-ticket detail page.
//
// Server component for the initial fetch; TicketDetail is the
// interactive client component (handles reply form, close dialog,
// and router.refresh() after mutations).
//
// 404 from the backend (the not-owned-or-not-found case — we don't
// distinguish, to avoid existence leaks) maps to Next's notFound().
export default async function TicketDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect(`/login?next=/student/tickets/${params.id}`);

  let data: TicketDetailData | null = null;
  try {
    data = await apiServer.get<TicketDetailData>(
      `/students/me/tickets/${params.id}`,
    );
  } catch (err) {
    if (err instanceof ApiServerError && err.statusCode === 404) notFound();
    throw err;
  }
  if (!data) notFound();

  return (
    <div className="min-h-screen bg-[#faf8f3]">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8 md:py-12">
        <TicketDetail initial={data} />
      </div>
    </div>
  );
}
