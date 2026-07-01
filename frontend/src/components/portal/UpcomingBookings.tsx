import { CalendarClock } from 'lucide-react';
import { apiServer } from '@/lib/apiServer';

// Client portal — "Your upcoming sessions". Server component: fetches the
// signed-in client's bookings from GET /booking/mine (cookie-bound) and
// renders them calmly. Times are shown in the booking's stored timezone,
// clearly labelled (client-local timezone is a later step). Failure is
// non-fatal — the section just renders the empty state.

interface Booking {
  id: string;
  type: string;
  scheduledAt: string;
  scheduledEndAt: string | null;
  durationMinutes: number | null;
  timezone: string | null;
  staffName: string | null;
  meetingLink: string | null;
  status: string;
}

const TYPE_LABEL: Record<string, string> = {
  FREE_15: 'Free 15-minute consultation',
  GAP_CLOSING: 'Gap-Closing session',
  LIA: 'LIA Consultation',
  ADMISSION: 'Admission consultation',
};

function fmtDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(iso));
}
function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

export async function UpcomingBookings() {
  let bookings: Booking[] = [];
  try {
    bookings = await apiServer.get<Booking[]>('/booking/mine');
  } catch {
    bookings = [];
  }

  return (
    <section className="rounded-2xl bg-white border border-gray-200 p-5 md:p-6">
      <div className="flex items-center gap-2 mb-4">
        <CalendarClock size={16} className="text-[#b8941f]" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
          Your upcoming sessions
        </h2>
      </div>

      {bookings.length === 0 ? (
        <p className="text-sm text-gray-500">You have no upcoming sessions.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {bookings.map((b) => {
            const tz = b.timezone ?? 'Pacific/Auckland';
            return (
              <li key={b.id} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-semibold text-[#1e3a5f]">
                  {TYPE_LABEL[b.type] ?? b.type}
                </p>
                <p className="text-sm text-gray-700">
                  {fmtDate(b.scheduledAt, tz)} at {fmtTime(b.scheduledAt, tz)}
                  <span className="text-gray-400"> ({tz})</span>
                </p>
                {b.staffName && (
                  <p className="text-xs text-gray-500 mt-0.5">with {b.staffName}</p>
                )}
                {b.meetingLink && (
                  <a
                    href={b.meetingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#F3CE49] px-3 py-1.5 text-xs font-semibold text-[#1e3a5f] hover:bg-[#F3CE49]/90"
                  >
                    Join your session
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
