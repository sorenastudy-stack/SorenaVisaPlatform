'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// PR-DASH-3 — Cancel confirmation overlay.
//
// Inline modal with optional reason. Posts to /cancel; reason is
// cleartext per spec.
export function CancelMeetingOverlay({
  meetingId,
  onClose,
  onCancelled,
}: {
  meetingId: string;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const t = useTranslations();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const onConfirm = async () => {
    setBusy(true);
    try {
      await api.post(`/api/consultant/meetings/${meetingId}/cancel`, {
        reason: reason.trim() || undefined,
      });
      onCancelled();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Cancel failed';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => { if (!busy) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-sorena-navy">
          {t('meetings.consultant.cancel')}
        </h2>
        <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-600">
          {t('meetings.consultant.cancelReason')}
        </label>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          className="mt-1 w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy focus:outline-none"
        />
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex h-12 items-center justify-center rounded-xl bg-rose-600 px-5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
          >
            {busy ? 'Cancelling…' : 'Confirm cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
