'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';

// PR-DASH-4 — Pattern 1 escalation offer card.
//
// Renders directly below an assistant message that has
// `escalationOffered === true` and no `escalatedTicketId`. The
// student decides: accept → backend creates a real VisaSupportTicket
// (PR-DASH-2) and links it back; decline → audit-only, no ticket.
//
// On accept we show an inline success state with a link to the new
// ticket so the student can jump straight to the human thread.

export function EscalationOfferCard({
  conversationId,
  messageId,
  onAccepted,
}: {
  conversationId: string;
  messageId: string;
  // Parent re-fetches the conversation so the card swaps for an
  // EscalationLinkedBadge on the next render. We also surface the
  // ticket id here so the inline success state has somewhere to
  // link to even before the refresh lands.
  onAccepted: (ticketId: string) => void;
}) {
  const t = useTranslations();
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [createdTicketId, setCreatedTicketId] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  const onAccept = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ escalatedTicketId: string | null }>(
        `/api/student/chatbot/conversations/${conversationId}/messages/${messageId}/escalate`,
        { accept: true, additionalContext: extra.trim() || undefined },
      );
      if (res.escalatedTicketId) {
        setCreatedTicketId(res.escalatedTicketId);
        onAccepted(res.escalatedTicketId);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create ticket');
    } finally {
      setBusy(false);
    }
  };

  const onDecline = async () => {
    setBusy(true);
    try {
      await api.post(
        `/api/student/chatbot/conversations/${conversationId}/messages/${messageId}/escalate`,
        { accept: false },
      );
      setDeclined(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record');
    } finally {
      setBusy(false);
    }
  };

  if (declined) return null;

  if (createdTicketId) {
    return (
      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start gap-2">
          <CheckCircle2 size={18} className="mt-0.5 text-emerald-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-900">
              {t('chat.escalation.created')}
            </p>
            <Link
              href={`/student/tickets/${createdTicketId}`}
              className="mt-1 inline-block text-sm font-semibold text-sorena-navy underline"
            >
              {t('chat.escalation.linkedBadge')} #{createdTicketId.slice(0, 8)}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-sorena-navy/20 bg-white p-4 shadow-sm">
      <p className="text-sm font-bold text-sorena-navy">
        {t('chat.escalation.title')}
      </p>
      <p className="mt-1 text-sm text-slate-700">
        {t('chat.escalation.body')}
      </p>
      <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-600">
        {t('chat.escalation.extraContextLabel')}
      </label>
      <textarea
        rows={2}
        value={extra}
        onChange={(e) => setExtra(e.target.value)}
        maxLength={2000}
        className="mt-1 w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-sorena-navy focus:border-sorena-navy focus:outline-none"
      />
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <button
          type="button"
          onClick={onDecline}
          disabled={busy}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          {t('chat.escalation.decline')}
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={busy}
          className="inline-flex h-12 items-center justify-center rounded-xl bg-sorena-navy px-6 text-base font-semibold text-white hover:brightness-110 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy focus-visible:ring-offset-2"
        >
          {t('chat.escalation.accept')}
        </button>
      </div>
    </div>
  );
}
