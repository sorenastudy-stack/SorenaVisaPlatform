'use client';

import { useTranslations } from 'next-intl';

// PR-DASH-3 — Status pill.
//
// Used by both student and consultant lists. Colors per spec:
// SCHEDULED=navy, COMPLETED=emerald (existing token), CANCELLED=gray,
// NO_SHOW=warm red.
const STATUS_BG: Record<string, string> = {
  SCHEDULED: 'bg-sorena-navy text-white',
  COMPLETED: 'bg-emerald-600 text-white',
  CANCELLED: 'bg-slate-500 text-white',
  NO_SHOW:   'bg-rose-700 text-white',
};

const STATUS_KEY: Record<string, string> = {
  SCHEDULED: 'meetings.status.scheduled',
  COMPLETED: 'meetings.status.completed',
  CANCELLED: 'meetings.status.cancelled',
  NO_SHOW:   'meetings.status.noShow',
};

export function MeetingStatusBadge({ status }: { status: string }) {
  const t = useTranslations();
  const cls = STATUS_BG[status] ?? STATUS_BG.SCHEDULED;
  const key = STATUS_KEY[status] ?? STATUS_KEY.SCHEDULED;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}
    >
      {t(key as Parameters<typeof t>[0])}
    </span>
  );
}
