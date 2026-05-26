'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, X, CheckCircle2, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-5 — Internal-only review overlay. APPROVED / REJECTED + a
// required reason (10–2000 chars). Re-reviewing replaces the existing
// verdict (UPSERT on the backend). "Clear review" removes the row,
// returning the document to UNREVIEWED.

type Status = 'APPROVED' | 'REJECTED';

export function ReviewDocumentButton({
  caseId,
  source,
  sourceRowId,
  fileName,
  existingStatus,
  existingReason,
  existingReviewerName,
}: {
  caseId: string;
  source: 'ADMISSION' | 'APPLICATION' | 'VISA_SUPPORTING';
  sourceRowId: string;
  fileName: string;
  existingStatus: 'UNREVIEWED' | 'APPROVED' | 'REJECTED';
  existingReason: string | null;
  existingReviewerName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>(
    existingStatus === 'REJECTED' ? 'REJECTED' : 'APPROVED',
  );
  const [reason, setReason] = useState(existingReason ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedLen = reason.trim().length;
  const canSubmit = trimmedLen >= 10 && trimmedLen <= 2000 && !submitting && !clearing;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(
        `/cases/${caseId}/documents/${source}/${sourceRowId}/review`,
        { status, reason: reason.trim() },
      );
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save review.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClear = async () => {
    if (existingStatus === 'UNREVIEWED' || clearing || submitting) return;
    setClearing(true);
    setError(null);
    try {
      await api.delete(`/cases/${caseId}/documents/${source}/${sourceRowId}/review`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to clear review.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Review ${fileName}`}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#1E3A5F] bg-white border border-gray-200 hover:border-[#1E3A5F] transition-colors"
      >
        <ClipboardCheck size={12} />
        {existingStatus === 'UNREVIEWED' ? 'Review' : 'Edit review'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => (submitting || clearing ? null : setOpen(false))}
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-[#1E3A5F]/10 flex items-center justify-center flex-shrink-0">
                  <ClipboardCheck size={18} className="text-[#1E3A5F]" />
                </div>
                <h2 className="text-lg font-bold text-[#1E3A5F]">Review document</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting || clearing}
                className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-1 truncate" title={fileName}>
              <span className="font-semibold">{fileName}</span>
            </p>
            <p className="text-xs text-[#4A4A4A]/60 mb-4">
              Internal only — the client does not see this verdict. If you need a re-upload, message them via the case thread.
            </p>

            {existingStatus !== 'UNREVIEWED' && (
              <div className={`rounded-lg border p-3 mb-4 text-xs ${
                existingStatus === 'APPROVED'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}>
                <div className="font-semibold mb-1">
                  Current verdict: {existingStatus}{existingReviewerName ? ` · ${existingReviewerName}` : ''}
                </div>
                {existingReason && (
                  <p className="whitespace-pre-wrap leading-relaxed">{existingReason}</p>
                )}
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={submitting || clearing}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#C0392B] hover:underline disabled:opacity-50"
                >
                  {clearing ? '…' : 'Clear this review'}
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                type="button"
                onClick={() => setStatus('APPROVED')}
                disabled={submitting || clearing}
                className={`min-h-[48px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-semibold transition-colors ${
                  status === 'APPROVED'
                    ? 'bg-emerald-100 border-emerald-400 text-emerald-900'
                    : 'bg-white border-gray-200 text-[#4A4A4A] hover:border-emerald-300'
                }`}
              >
                <CheckCircle2 size={16} /> Approve
              </button>
              <button
                type="button"
                onClick={() => setStatus('REJECTED')}
                disabled={submitting || clearing}
                className={`min-h-[48px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-semibold transition-colors ${
                  status === 'REJECTED'
                    ? 'bg-red-100 border-red-400 text-red-900'
                    : 'bg-white border-gray-200 text-[#4A4A4A] hover:border-red-300'
                }`}
              >
                <XCircle size={16} /> Reject
              </button>
            </div>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">
              Reason (min 10 chars)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={5}
              maxLength={2000}
              disabled={submitting || clearing}
              placeholder="Notes only the LIA team will see…"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none resize-y disabled:bg-gray-50"
            />
            <div className="text-xs text-[#4A4A4A]/60 mt-1">{trimmedLen} / 2000</div>

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting || clearing}
                className="min-h-[48px] px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={`min-h-[48px] px-5 py-2.5 rounded-xl text-white text-sm font-semibold disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed ${
                  status === 'APPROVED'
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : 'bg-red-700 hover:bg-red-800'
                }`}
              >
                {submitting ? '…' : status === 'APPROVED' ? 'Approve' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
