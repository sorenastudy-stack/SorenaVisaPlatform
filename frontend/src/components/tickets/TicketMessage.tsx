'use client';

import { useTranslations } from 'next-intl';
import { formatRelativeTime } from '@/lib/format-relative-time';

// PR-DASH-2 — One message bubble.
//
// CLIENT messages right-align with an off-white bubble (matches the
// page background — feels like a quoted thought). STAFF messages
// left-align with a soft navy tint. SYSTEM rows are handled by
// TicketSystemEvent, not this component.
export function TicketMessage({
  authorRole,
  authorDisplayName,
  body,
  createdAt,
}: {
  authorRole: 'CLIENT' | 'STAFF' | 'SYSTEM';
  authorDisplayName: string;
  body: string;
  createdAt: string;
}) {
  const t = useTranslations();
  const isClient = authorRole === 'CLIENT';
  return (
    <div className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%] md:max-w-[70%]">
        <div className="flex items-baseline gap-2 px-1 pb-1 text-xs text-slate-500">
          <span className="font-semibold text-sorena-navy">
            {isClient ? t('tickets.detail.authorYou') : authorDisplayName}
          </span>
          <span>•</span>
          <span>{formatRelativeTime(createdAt)}</span>
        </div>
        <div
          className={[
            'rounded-2xl px-4 py-3 text-sm leading-relaxed',
            isClient
              ? 'bg-[#faf8f3] text-sorena-navy'
              : 'bg-[#e8edf5] text-sorena-navy',
          ].join(' ')}
        >
          <p className="whitespace-pre-wrap">{body}</p>
        </div>
      </div>
    </div>
  );
}
