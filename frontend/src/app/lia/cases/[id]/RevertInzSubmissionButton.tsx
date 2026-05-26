'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, X, RotateCcw } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-7 — Two-step destructive confirmation for reverting an INZ
// submission. Mirrors PR-CONSULT-4's HardDeleteConfirmOverlay: the
// Revert button stays disabled until the LIA types the case ID into
// the confirmation field. Required reason (10–500 chars) lands
// encrypted on the audit row.

export function RevertInzSubmissionButton({
  caseId,
  currentReference,
}: {
  caseId: string;
  currentReference: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typedCaseId, setTypedCaseId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonLen = reason.trim().length;
  const idMatches = typedCaseId.trim() === caseId;
  const reasonValid = reasonLen >= 10 && reasonLen <= 500;
  const canSubmit = idMatches && reasonValid && !submitting;

  const reset = () => {
    setTypedCaseId('');
    setReason('');
    setError(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/cases/${caseId}/inz-submission/revert`, {
        reason: reason.trim(),
      });
      setOpen(false);
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to revert INZ submission.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs font-semibold px-3 py-2 hover:border-red-400 transition-colors"
      >
        <RotateCcw size={12} />
        Revert submission
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => (submitting ? null : (setOpen(false), reset()))} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={18} className="text-red-700" />
                </div>
                <h2 className="text-lg font-bold text-red-800">Revert INZ submission</h2>
              </div>
              <button type="button" onClick={() => (setOpen(false), reset())} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-red-900 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 leading-relaxed">
              This rolls the case back to <strong>VISA</strong> stage and clears the captured INZ reference, date, notes, and receipt link. The receipt file stays on disk (recoverable from the audit log) — only the metadata is cleared.
            </p>

            <p className="text-xs text-[#4A4A4A] mb-4">
              Currently submitted: <strong>{currentReference}</strong>
            </p>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">
              Reason (10–500 chars, audited)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={500}
              disabled={submitting}
              placeholder="Why are we reverting?"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none resize-y disabled:bg-gray-50"
            />
            <div className="text-xs text-[#4A4A4A]/60 mt-1 mb-3">{reasonLen} / 500</div>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">
              Type the case ID to confirm:{' '}
              <code className="bg-gray-100 text-[#1E3A5F] px-1.5 py-0.5 rounded font-mono">{caseId}</code>
            </label>
            <input
              type="text"
              value={typedCaseId}
              onChange={(e) => setTypedCaseId(e.target.value)}
              disabled={submitting}
              placeholder="Paste the case ID here"
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 font-mono text-sm focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none disabled:bg-gray-50"
              autoComplete="off"
            />

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => (setOpen(false), reset())} disabled={submitting} className="min-h-[44px] px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="min-h-[44px] px-5 py-2 rounded-xl bg-red-700 text-white text-sm font-semibold hover:bg-red-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                {submitting ? 'Reverting…' : 'Revert submission'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
