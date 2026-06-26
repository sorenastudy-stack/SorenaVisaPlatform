'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Edit, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-7 — In-place edit of the INZ submission record.
//
// Receipt file is NOT editable here (read-only — the LIA must revert
// and resubmit to swap the receipt). This overlay handles the
// reference number, submitted-at date, and notes only.

export function EditInzSubmissionButton({
  caseId,
  currentReference,
  currentSubmittedAt,
  currentNotes,
}: {
  caseId: string;
  currentReference: string;
  currentSubmittedAt: string;
  currentNotes: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState(currentReference);
  const [submittedAt, setSubmittedAt] = useState(
    currentSubmittedAt ? currentSubmittedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState(currentNotes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setReference(currentReference);
    setSubmittedAt(currentSubmittedAt ? currentSubmittedAt.slice(0, 10) : '');
    setNotes(currentNotes ?? '');
    setError(null);
  };

  const refTrimmed = reference.trim();
  const notesTrimmed = notes.trim();
  const refChanged = refTrimmed !== currentReference;
  const dateChanged = submittedAt !== currentSubmittedAt.slice(0, 10);
  const notesChanged = notesTrimmed !== (currentNotes ?? '');
  const anyChange = refChanged || dateChanged || notesChanged;
  const refValid = refTrimmed.length >= 1 && refTrimmed.length <= 128;
  const canSubmit = anyChange && refValid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (refChanged) body.inzApplicationNumber = refTrimmed;
      if (dateChanged) body.submittedAt = new Date(submittedAt + 'T00:00:00').toISOString();
      if (notesChanged) body.notes = notesTrimmed;
      await api.patch(`/cases/${caseId}/inz-submission`, body);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to update INZ submission.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-[#1E3A5F] text-xs font-semibold px-3 py-2 hover:border-[#1E3A5F] transition-colors"
      >
        <Edit size={12} />
        Edit submission
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => (submitting ? null : (setOpen(false), reset()))} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-[#1E3A5F]/10 flex items-center justify-center flex-shrink-0">
                  <Edit size={18} className="text-[#1E3A5F]" />
                </div>
                <h2 className="text-lg font-bold text-[#1E3A5F]">Edit INZ submission</h2>
              </div>
              <button type="button" onClick={() => (setOpen(false), reset())} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
              Fix a typo in the reference, correct the submission date, or update notes. The receipt file is read-only — to swap it, revert the submission and resubmit.
            </p>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">INZ reference number</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={128}
              disabled={submitting}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-3"
            />

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Submitted on</label>
            <input
              type="date"
              value={submittedAt}
              onChange={(e) => setSubmittedAt(e.target.value)}
              disabled={submitting}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-3"
            />

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              disabled={submitting}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none resize-y disabled:bg-gray-50"
            />

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}
            {!anyChange && !error && (
              <p className="text-xs text-[#4A4A4A]/60 mt-3">Make a change to enable Save.</p>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => (setOpen(false), reset())} disabled={submitting} className="min-h-[44px] px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="min-h-[44px] px-5 py-2 rounded-xl bg-[#1E3A5F] text-white text-sm font-semibold hover:bg-[#F3CE49] hover:text-[#1E3A5F] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                {submitting ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
