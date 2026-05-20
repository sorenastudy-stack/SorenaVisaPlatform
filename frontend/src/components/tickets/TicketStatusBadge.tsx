'use client';

import { useTranslations } from 'next-intl';

// PR-DASH-2 — Status badge.
//
// Solid-fill colour per status, mapped to the project's existing
// gold/navy palette plus Tailwind emerald/slate. The badges show up
// in the dashboard summary card, the list view, and the detail
// header — same colour scheme everywhere.
const STATUS_BG: Record<string, string> = {
  OPEN:        'bg-sorena-gold text-white',
  IN_PROGRESS: 'bg-sorena-navy text-white',
  RESOLVED:    'bg-emerald-600 text-white',
  CLOSED:      'bg-slate-500 text-white',
};

export function TicketStatusBadge({ status }: { status: string }) {
  const t = useTranslations();
  const cls = STATUS_BG[status] ?? STATUS_BG.OPEN;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}
    >
      {t(`tickets.status.${status}` as Parameters<typeof t>[0])}
    </span>
  );
}
