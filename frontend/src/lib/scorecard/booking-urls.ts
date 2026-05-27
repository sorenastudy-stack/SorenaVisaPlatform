// PR-SCORECARD-4 — Booking destination URLs.
//
// Booking URLs are now OWNER-editable via /staff/platform-settings.
// The frontend fetches the three URLs from the public backend route
// GET /scorecard/booking-urls and caches them for the lifetime of
// the tab. Network failure falls back to the hard-coded constants
// so a blip during navigation doesn't break the booking button.
//
// The OWNER edits these in the UI, the backend persists them in
// the PlatformSetting table, and a 60s server-side cache keeps the
// DB cool during traffic bursts.

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

export interface BookingUrls {
  FREE_15MIN: string;
  GAP_CLOSING_PAYMENT: string;
  LIA_CONSULTATION: string;
}

// Hard-coded fallback. Used (a) on network failure, (b) as the
// optimistic default in components that render before the fetch
// resolves. Kept in sync with the migration seed values.
export const FALLBACK_BOOKING_URLS: BookingUrls = {
  FREE_15MIN:          'https://www.sorenavisa.com/book-free-consultation',
  GAP_CLOSING_PAYMENT: 'https://www.sorenavisa.com/gap-closing-session-payment',
  LIA_CONSULTATION:    'https://www.sorenavisa.com/lia-consultation-payment',
} as const;

// Module-level cache so a page with multiple components that need
// the URLs (header, body, footer) only ever issues one request.
let cached: BookingUrls | null = null;
let inFlight: Promise<BookingUrls> | null = null;

export async function getBookingUrls(): Promise<BookingUrls> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/scorecard/booking-urls`, {
        credentials: 'omit',
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as BookingUrls;
      cached = data;
      return data;
    } catch {
      // Network blip → keep going with the fallback. We do NOT
      // cache the fallback so the next call retries.
      return FALLBACK_BOOKING_URLS;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// PR-SCORECARD-2 compatibility export — components that were imported
// the BOOKING_URLS constant get the fallback synchronously, then
// re-render once getBookingUrls() resolves. The active code path in
// ScorecardResultClient uses getBookingUrls() directly.
export const BOOKING_URLS = FALLBACK_BOOKING_URLS;
