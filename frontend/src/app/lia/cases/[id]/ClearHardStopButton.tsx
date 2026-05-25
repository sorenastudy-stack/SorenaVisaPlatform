'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldOff, X, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-1 — Clear hard-stop overlay.
//
// PATCH /cases/:id/clear-hard-stop. Requires a written justification
// (min 10, max 5000). Backend pairs the call with a LegalNote row +
// an AuditLog entry.

export function ClearHardStopButton({
  caseId, disabled, hint,
}: {
  caseId: string;
  disabled: boolean;
  hint: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedLen = reason.trim().length;
  const canSubmit = trimmedLen >= 10 && trimmedLen <= 5000 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.patch(`/cases/${caseId}/clear-hard-stop`, { reason: reason.trim() });
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to clear hard stop.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border-2 border-red-200 bg-red-50 text-red-800 text-sm font-semibold px-4 py-2.5 hover:border-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ShieldOff size={16} />
        Clear hard stop
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => (submitting ? null : setOpen(false))} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={18} className="text-red-700" />
                </div>
                <h2 className="text-lg font-bold text-red-800">Clear hard stop</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
              This will set <code className="px-1 rounded bg-gray-100 text-xs">executionAllowed=true</code> on the underlying lead. The action is audited and a justification is required.
            </p>

            {hint && (
              <p className="text-xs text-[#4A4A4A]/70 mb-3 italic">
                Previous reason: {hint}
              </p>
            )}

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Justification (min 10 chars)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={5}
              maxLength={5000}
              disabled={submitting}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none resize-y disabled:bg-gray-50"
            />
            <div className="text-xs text-[#4A4A4A]/60 mt-1">{trimmedLen} / 5000</div>

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={submitting} className="min-h-[48px] px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="min-h-[48px] px-5 py-2.5 rounded-xl bg-red-700 text-white text-sm font-semibold hover:bg-red-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                {submitting ? '…' : 'Clear hard stop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
