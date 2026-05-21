'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { ApprovalRequest, ApproveResponse } from './types';

// PR-CONSULT-3 — Approve / reject decision overlay.
//
// Used for both decisions — the only differences are the title,
// confirm-button colour, and the underlying endpoint. Decision
// note is optional. On Approve we surface the executionResult: if
// `ok` is false, show the error message; otherwise show the
// generic "Approved and executed" success.

export function ApprovalDecisionOverlay({
  request,
  mode,
  open,
  onClose,
  onDone,
}: {
  request: ApprovalRequest;
  mode:    'approve' | 'reject';
  open:    boolean;
  onClose: () => void;
  onDone:  () => void;
}) {
  const t = useTranslations();
  const [decisionNote, setDecisionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (mode === 'approve') {
        const res = await api.post<ApproveResponse>(
          `/api/staff/owner-approval/${request.id}/approve`,
          { decisionNote: decisionNote.trim() || undefined },
        );
        if (res.executionResult.ok) {
          toast.success(t('staff.approvals.executed'));
        } else {
          toast.error(
            t('staff.approvals.executionFailed', {
              error: res.executionResult.error ?? '—',
            }),
            { duration: 10000 },
          );
        }
      } else {
        await api.post(`/api/staff/owner-approval/${request.id}/reject`, {
          decisionNote: decisionNote.trim() || undefined,
        });
        toast.info(t('staff.approvals.status.REJECTED'));
      }
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Decision failed');
    } finally {
      setSubmitting(false);
    }
  };

  const isApprove = mode === 'approve';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => (submitting ? null : onClose())}
      />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className={`text-lg font-bold ${isApprove ? 'text-emerald-700' : 'text-rose-700'}`}>
            {isApprove ? t('staff.approvals.confirmApprove') : t('staff.approvals.confirmReject')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            {t('staff.approvals.decisionNote')}
          </label>
          <textarea
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
          />
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className={[
            'w-full rounded-xl font-semibold py-3 transition-colors min-h-[48px] disabled:opacity-50 disabled:cursor-not-allowed text-white',
            isApprove ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700',
          ].join(' ')}
        >
          {submitting
            ? '…'
            : (isApprove ? t('staff.approvals.confirmApprove') : t('staff.approvals.confirmReject'))
          }
        </button>
      </div>
    </div>
  );
}
