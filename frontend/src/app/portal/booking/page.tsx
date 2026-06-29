'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { CalendarClock } from 'lucide-react';

// Client portal — placeholder booking page. All booking/scheduling now
// lives inside the portal (not on public pages, not via external Wix
// links). This is a reassuring placeholder: the scorecard result CTAs
// route here with a ?type= so the user sees the right consultation
// name. The real scheduling/payment UI lands in a later PR.

const HEADINGS: Record<string, string> = {
  free15: 'Your free 15-minute consultation',
  gap:    'Your Gap-Closing session',
  lia:    'Your LIA Consultation',
};

const DEFAULT_HEADING = 'Book your consultation';

function BookingPlaceholder() {
  const searchParams = useSearchParams();
  const type = searchParams.get('type') ?? '';
  const heading = HEADINGS[type] ?? DEFAULT_HEADING;

  return (
    <div className="mx-auto max-w-xl">
      <section className="rounded-2xl bg-white border border-sorena-navy/10 p-8 md:p-12 text-center shadow-sm">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-sorena-gold/15">
          <CalendarClock size={26} className="text-sorena-navy" />
        </div>

        <h1 className="text-2xl md:text-3xl font-bold text-sorena-navy">
          {heading}
        </h1>

        <p className="mt-4 text-base leading-relaxed text-sorena-text/80">
          Booking is coming to your portal. Your case advisor has been notified
          and will be in touch to schedule this with you.
        </p>

        <div className="mt-10">
          <Link
            href="/portal/case"
            className="group inline-flex min-h-[3rem] items-center justify-center rounded-xl bg-sorena-gold px-8 py-3.5 text-sorena-navy font-semibold shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:bg-sorena-gold/90 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy focus-visible:ring-offset-2 focus-visible:ring-offset-sorena-cream"
          >
            Back to my case
          </Link>
        </div>
      </section>
    </div>
  );
}

export default function PortalBookingPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<div className="mx-auto max-w-xl text-center text-sm text-sorena-text/60">Loading…</div>}>
      <BookingPlaceholder />
    </Suspense>
  );
}
