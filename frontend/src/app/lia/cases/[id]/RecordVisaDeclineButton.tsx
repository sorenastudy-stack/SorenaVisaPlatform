'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { XCircle, X, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-8 — "Record Decline" overlay.
//
// JSON POST /cases/:id/visa/decline. The decline reason is the LIA's
// internal commentary — encrypted at rest on Visa.declineReasonEncrypted,
// NEVER shared with the client. The client-facing decline email only
// tells them the application wasn't approved and to expect contact.

export function RecordVisaDeclineButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonLen = declineReason.trim().length;
  const reasonValid = reasonLen >= 10 && reasonLen <= 5000;
  const canSubmit = reasonValid && !submitting;

  const reset = () => {
    setDeclineReason('');
    setNotes('');
    setError(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/cases/${caseId}/visa/decline`, {
        declineReason: declineReason.trim(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setOpen(false);
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to record visa decline.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[48px] inline-flex items-center gap-2 rounded-xl border-2 border-red-300 bg-white text-red-800 text-sm font-bold px-5 py-2 hover:bg-red-50 transition-colors"
      >
        <XCircle size={16} />
        Record decline
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => (submitting ? null : (setOpen(false), reset()))} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto border-t-4 border-red-500">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={18} className="text-red-700" />
                </div>
                <h2 className="text-lg font-bold text-red-800">Record visa decline</h2>
              </div>
              <button type="button" onClick={() => (setOpen(false), reset())} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-red-900 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 leading-relaxed">
              This marks the case as <strong>COMPLETED</strong> with a decline outcome. The client receives an email saying their application wasn't approved — your decline reason below is <strong>NOT</strong> shared with them.
            </p>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">
              Decline reason (confidential, 10–5000 chars)
            </label>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              rows={6}
              maxLength={5000}
              disabled={submitting}
              placeholder="INZ's stated reason + your internal notes…"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none resize-y disabled:bg-gray-50"
            />
            <div className="text-xs text-[#4A4A4A]/60 mt-1 mb-3">
              {reasonLen} / 5000 · This text is encrypted at rest and visible to staff only.
            </div>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Additional notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              disabled={submitting}
              placeholder="Next-step plan, follow-up actions…"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none resize-y disabled:bg-gray-50"
            />

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => (setOpen(false), reset())} disabled={submitting} className="min-h-[44px] px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="min-h-[44px] px-5 py-2 rounded-xl bg-red-700 text-white text-sm font-semibold hover:bg-red-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                {submitting ? 'Recording…' : 'Record decline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
