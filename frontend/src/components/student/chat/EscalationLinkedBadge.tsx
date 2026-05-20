'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Ticket } from 'lucide-react';

// PR-DASH-4 — "Linked to ticket #..." badge.
//
// Rendered under an assistant message AFTER the student accepted
// escalation. The ticket id is the full UUID; we display only the
// first 8 chars for a glanceable shorthand (matches PR-DASH-2's
// ticket shortcode convention).
export function EscalationLinkedBadge({ ticketId }: { ticketId: string }) {
  const t = useTranslations();
  const short = ticketId.slice(0, 8);
  return (
    <Link
      href={`/student/tickets/${ticketId}`}
      className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
    >
      <Ticket size={12} />
      {t('chat.escalation.linkedBadge')} #{short}
    </Link>
  );
}
