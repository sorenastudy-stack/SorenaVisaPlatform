'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { isPendingApproval, type ActionResult } from './types';
import { notifySentForApproval } from './notify';

// PR-CONSULT-3 — Deactivate confirmation overlay.
//
// POST /api/staff/users/:id/deactivate. OWNER inline; SUPER_ADMIN
// enqueued. The warning text spells out the cascade: every active
// case assignment held by this user is closed and auto-reallocated.

export function DeactivateConfirmOverlay({
  userId,
  open,
  onClose,
  onDone,
}: {
  userId:  string;
  open:    boolean;
  onClose: () => void;
  onDone:  () => void;
}) {
  const t = useTranslations();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const result = await api.post<ActionResult>(`/api/staff/users/${userId}/deactivate`, {
        reason: reason.trim() || undefined,
      });
      if (isPendingApproval(result)) {
        notifySentForApproval(t('staff.users.sentForApproval'), t('staff.users.sentForApprovalLink'));
      } else {
        toast.success('Staff deactivated');
      }
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to deactivate');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => (submitting ? null : onClose())}
      />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-bold text-rose-700">
            {t('staff.users.detail.deactivate')}
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

        <p className="text-sm text-gray-600 mb-4 leading-relaxed">
          {t('staff.users.deactivate.warning')}
        </p>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            {t('staff.users.deactivate.reason')}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
          />
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full rounded-xl bg-rose-600 text-white font-semibold py-3 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-rose-700 transition-colors min-h-[48px]"
        >
          {submitting ? '…' : t('staff.users.detail.deactivate')}
        </button>
      </div>
    </div>
  );
}
