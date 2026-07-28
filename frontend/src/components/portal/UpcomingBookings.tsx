import { getTranslations, getLocale } from 'next-intl/server';
import { CalendarClock } from 'lucide-react';
import { apiServer } from '@/lib/apiServer';
import { CancelBookingButton } from './CancelBookingButton';

// Client portal — "Your upcoming sessions". Server component: fetches the
// signed-in client's bookings from GET /booking/mine (cookie-bound) and renders
// them calmly. Times shown in the booking's stored timezone, clearly labelled.
// Failure is non-fatal — the section just renders the empty state.

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

const KNOWN_TYPES = new Set(['FREE_15', 'GAP_CLOSING', 'LIA', 'ADMISSION']);

function fmtDate(iso: string, tz: string, locale: 'en' | 'fa'): string {
  return new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-NZ', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(iso));
}
function fmtTime(iso: string, tz: string, locale: 'en' | 'fa'): string {
  return new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-NZ', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

export async function UpcomingBookings() {
  const t = await getTranslations('upcomingBookings');
  const locale = (await getLocale()) as 'en' | 'fa';

  let bookings: Booking[] = [];
  try {
    bookings = await apiServer.get<Booking[]>('/booking/mine');
  } catch {
    bookings = [];
  }

  return (
    <section className="rounded-2xl bg-white border border-gray-200 p-5 md:p-6">
      <div className="flex items-center gap-2 mb-4">
        <CalendarClock size={16} className="text-[#b28f4e]" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">{t('heading')}</h2>
      </div>

      {bookings.length === 0 ? (
        <p className="text-sm text-gray-500">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {bookings.map((b) => {
            const tz = b.timezone ?? 'Pacific/Auckland';
            return (
              <li key={b.id} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-semibold text-[#1e3a5f]">
                  {KNOWN_TYPES.has(b.type) ? t(`types.${b.type}`) : b.type}
                </p>
                <p className="text-sm text-gray-700">
                  {fmtDate(b.scheduledAt, tz, locale)} · {fmtTime(b.scheduledAt, tz, locale)}
                  <span className="text-gray-400"> ({tz})</span>
                </p>
                {b.staffName && (
                  <p className="text-xs text-gray-500 mt-0.5">{t('withStaff', { name: b.staffName })}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {b.meetingLink && (
                    <a
                      href={b.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#c9a961] px-3 py-1.5 text-xs font-semibold text-[#1e3a5f] hover:bg-[#c9a961]/90"
                    >
                      {t('join')}
                    </a>
                  )}
                  <CancelBookingButton bookingId={b.id} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
