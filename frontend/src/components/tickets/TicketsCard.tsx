'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Ticket } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { TicketStatusBadge } from './TicketStatusBadge';
import { formatRelativeTime } from '@/lib/format-relative-time';

// PR-DASH-2 — Dashboard summary card for tickets.
//
// Replaces PR-DASH-1's placeholder. Shows the open-ticket count, up
// to 3 latest OPEN/IN_PROGRESS tickets (subject + status + relative
// time), a primary "Open a new ticket" CTA, and a "View all" link.
// When there are zero open tickets we hide the list and just show
// the primary CTA.

export interface DashboardTicketsSummary {
  openCount: number;
  latestOpen: Array<{
    id: string;
    subject: string;
    department: string;
    status: string;
    lastActivityAt: string;
  }>;
}

export function TicketsCard({ summary }: { summary: DashboardTicketsSummary }) {
  const t = useTranslations();
  const hasOpen = summary.openCount > 0;
  return (
    <Card className="bg-white animate-fade-in-up">
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="rounded-lg bg-[#1e3a5f]/5 p-2 text-sorena-navy">
          <Ticket size={20} />
        </div>
        <CardTitle>{t('tickets.dashboard.title')}</CardTitle>
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
          {hasOpen
            ? t('tickets.dashboard.openCount', { count: summary.openCount })
            : t('tickets.dashboard.noOpen')}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {hasOpen && (
          <ul className="flex flex-col divide-y divide-slate-100">
            {summary.latestOpen.map((t2) => (
              <li key={t2.id}>
                <Link
                  href={`/student/tickets/${t2.id}`}
                  className="flex items-center justify-between gap-3 py-2 transition-colors hover:bg-slate-50"
                >
                  <p className="truncate text-sm font-medium text-sorena-navy">
                    {t2.subject}
                  </p>
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <TicketStatusBadge status={t2.status} />
                    <span className="text-xs text-slate-500">
                      {formatRelativeTime(t2.lastActivityAt)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/student/tickets/new"
          className="inline-flex h-12 items-center justify-center rounded-xl bg-sorena-gold px-6 text-base font-semibold text-white transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sorena-gold focus-visible:ring-offset-2"
        >
          {t('tickets.list.openNew')}
        </Link>
        {hasOpen && (
          <Link
            href="/student/tickets"
            className="text-center text-sm font-semibold text-sorena-navy hover:underline"
          >
            {t('tickets.list.viewAll')}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
