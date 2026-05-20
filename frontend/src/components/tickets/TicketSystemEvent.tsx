'use client';

import { formatRelativeTime } from '@/lib/format-relative-time';

// PR-DASH-2 — Inline system-event row.
//
// Service-emitted messages (status changes, opens, closes) render as
// a gray italic line across the thread, not as a chat bubble — so
// they read as metadata rather than as someone "saying" something.
export function TicketSystemEvent({
  body,
  createdAt,
}: {
  body: string;
  createdAt: string;
}) {
  return (
    <div className="flex justify-center py-2">
      <p className="text-xs italic text-slate-500">
        {body} · {formatRelativeTime(createdAt)}
      </p>
    </div>
  );
}
