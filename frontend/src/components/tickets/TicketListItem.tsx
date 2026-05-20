'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { TicketStatusBadge } from './TicketStatusBadge';
import { TicketDepartmentBadge } from './TicketDepartmentBadge';
import { formatRelativeTime } from '@/lib/format-relative-time';

// PR-DASH-2 — Single row in the tickets list.
//
// Click anywhere on the row → detail page. Layout: subject + badges
// on the left, message count + last-activity time on the right.

export interface TicketRow {
  id: string;
  subject: string;
  department: string;
  status: string;
  priority: string;
  messageCount: number;
  lastStaffMessageAt: string | null;
  lastClientMessageAt: string | null;
  createdAt: string;
}

export function TicketListItem({ ticket }: { ticket: TicketRow }) {
  const t = useTranslations();
  const lastActivity =
    ticket.lastStaffMessageAt ?? ticket.lastClientMessageAt ?? ticket.createdAt;
  return (
    <Link
      href={`/student/tickets/${ticket.id}`}
      className="block rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-sorena-navy">
            {ticket.subject}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TicketStatusBadge status={ticket.status} />
            <TicketDepartmentBadge department={ticket.department} />
          </div>
        </div>
        <div className="whitespace-nowrap text-right text-xs text-slate-500">
          <p>{formatRelativeTime(lastActivity)}</p>
          <p className="mt-1">
            {t('tickets.detail.replyLabel')}: {ticket.messageCount}
          </p>
        </div>
      </div>
    </Link>
  );
}
