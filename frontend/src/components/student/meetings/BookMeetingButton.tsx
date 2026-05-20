'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Calendar } from 'lucide-react';
import { api } from '@/lib/api';

// PR-DASH-3 — Book-a-meeting button.
//
// Backend owns WIX_BOOKING_URL (kept off the client bundle so
// unauthenticated visitors can't scrape it). This component fetches
// /api/student/booking-config on mount. If a URL is returned, the
// button is enabled and opens the URL in a new tab. If null, the
// button doesn't render at all (per spec: "show... if WIX_BOOKING_URL
// is set. If not set, hide the button.").
export function BookMeetingButton() {
  const t = useTranslations();
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ wixBookingUrl: string | null }>('/api/student/booking-config')
      .then((res) => { if (!cancelled) setUrl(res.wixBookingUrl); })
      .catch(() => { /* leave hidden on error */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  if (!loaded || !url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-sorena-navy px-6 text-base font-semibold text-white transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy focus-visible:ring-offset-2"
    >
      <Calendar size={18} />
      {t('meetings.bookNew')}
    </a>
  );
}
