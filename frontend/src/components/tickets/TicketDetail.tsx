'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { TicketStatusBadge } from './TicketStatusBadge';
import { TicketDepartmentBadge } from './TicketDepartmentBadge';
import {
  TicketMessageThread,
  type ThreadMessage,
} from './TicketMessageThread';
import { CloseTicketDialog } from './CloseTicketDialog';

// PR-DASH-2 — Ticket detail container.
//
// Renders the subject + badges, the message thread, and a reply form
// (or the closed-state notice when status = CLOSED). Server-fetched
// data is passed in as `initial`; reply posts + close action use
// router.refresh() to re-fetch the server payload after mutations.
//
// Validation: replies must be ≥10 trimmed chars (server enforces too).
// The form trims on submit but the live char count uses the raw
// length so the user can see they've gone over 5000.

export interface TicketDetailData {
  id: string;
  subject: string;
  department: string;
  status: string;
  priority: string;
  createdAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  lastClientMessageAt: string | null;
  lastStaffMessageAt: string | null;
  messages: ThreadMessage[];
}

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 5000;

export function TicketDetail({ initial }: { initial: TicketDetailData }) {
  const t = useTranslations();
  const router = useRouter();

  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isClosed = initial.status === 'CLOSED';
  const replyTrim = reply.trim();
  const canSend = replyTrim.length >= MESSAGE_MIN && replyTrim.length <= MESSAGE_MAX && !sending;

  const onSend = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await api.post(`/students/me/tickets/${initial.id}/messages`, {
        body: replyTrim,
      });
      setReply('');
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      // The backend returns the i18n key as either the messageKey
      // field (for 429) or the message (for 400). Resolve here.
      if (msg.includes('rateLimit') || msg.includes('messageRateLimit')) {
        toast.error(t('tickets.errors.messageRateLimit'));
      } else if (msg.includes('closedTicket')) {
        toast.error(t('tickets.errors.closedTicket'));
      } else {
        toast.error(msg || t('tickets.errors.notFound'));
      }
    } finally {
      setSending(false);
    }
  };

  const onCloseConfirm = async () => {
    setClosing(true);
    try {
      await api.patch(`/students/me/tickets/${initial.id}/close`, {});
      setConfirmOpen(false);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      toast.error(msg || t('tickets.errors.notFound'));
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header strip */}
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-sorena-navy md:text-2xl">
            {initial.subject}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TicketStatusBadge status={initial.status} />
            <TicketDepartmentBadge department={initial.department} />
          </div>
        </div>
        {!isClosed && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-sorena-navy/40 bg-white px-4 text-sm font-semibold text-sorena-navy transition-colors hover:bg-sorena-navy/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy"
          >
            {t('tickets.detail.closeButton')}
          </button>
        )}
      </div>

      {/* Thread */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <TicketMessageThread messages={initial.messages} />
      </div>

      {/* Reply form OR closed notice */}
      {isClosed ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
          {t.rich('tickets.detail.closedNotice', {
            link: () => (
              <Link
                href="/student/tickets/new"
                className="font-semibold text-sorena-navy underline"
              >
                {t('tickets.detail.closedNoticeLink')}
              </Link>
            ),
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <label className="mb-2 block text-sm font-bold text-sorena-navy">
            {t('tickets.detail.replyLabel')}
          </label>
          <textarea
            rows={5}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={t('tickets.detail.replyPlaceholder')}
            className="w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-slate-400 focus:border-sorena-navy focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className={`text-xs ${reply.length > MESSAGE_MAX ? 'text-rose-600' : 'text-slate-500'}`}>
              {reply.length} / {MESSAGE_MAX}
            </p>
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-sorena-gold px-6 text-base font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sorena-gold focus-visible:ring-offset-2"
            >
              {t('tickets.detail.sendReply')}
            </button>
          </div>
        </div>
      )}

      <CloseTicketDialog
        open={confirmOpen}
        busy={closing}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={onCloseConfirm}
      />
    </div>
  );
}
