'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, X, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { DateInput } from '@/components/ui/DateInput';

// PR-LIA-7 — "Submit to INZ" overlay.
//
// Multipart upload to POST /cases/:id/inz-submission. The browser sets
// the multipart boundary automatically; api.upload doesn't override
// Content-Type. On success the modal closes and the page refreshes —
// the new "INZ Submission" panel renders from the updated server state.

const ALLOWED_RECEIPT_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
] as const;

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export function SubmitToInzButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [inzApplicationNumber, setInzApplicationNumber] = useState('');
  const [submittedAt, setSubmittedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refTrimmed = inzApplicationNumber.trim();
  const canSubmit =
    refTrimmed.length >= 1
    && refTrimmed.length <= 128
    && !!file
    && (file ? ALLOWED_RECEIPT_MIMES.includes(file.type as (typeof ALLOWED_RECEIPT_MIMES)[number]) : false)
    && (file ? file.size <= MAX_RECEIPT_BYTES : false)
    && !submitting;

  const reset = () => {
    setInzApplicationNumber('');
    setSubmittedAt(new Date().toISOString().slice(0, 10));
    setNotes('');
    setFile(null);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !file) return;
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('inzApplicationNumber', refTrimmed);
      if (submittedAt) {
        // Send as full ISO so the backend's class-transformer Date
        // parser keeps the LIA's selected day.
        fd.append('submittedAt', new Date(submittedAt + 'T00:00:00').toISOString());
      }
      if (notes.trim()) fd.append('notes', notes.trim());
      await api.upload(`/cases/${caseId}/inz-submission`, fd);
      setOpen(false);
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to submit to INZ.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[48px] inline-flex items-center gap-2 rounded-xl bg-[#F3CE49] text-[#1E3A5F] text-sm font-bold px-5 py-2.5 hover:bg-[#d4a615] transition-colors shadow-sm"
      >
        <Send size={16} />
        Submit to INZ
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => (submitting ? null : (setOpen(false), reset()))} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-[#F3CE49]/20 flex items-center justify-center flex-shrink-0">
                  <Send size={18} className="text-[#1E3A5F]" />
                </div>
                <h2 className="text-lg font-bold text-[#1E3A5F]">Submit to Immigration NZ</h2>
              </div>
              <button type="button" onClick={() => (setOpen(false), reset())} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
              Capture the INZ reference, the date you lodged, and the payment receipt PDF. The case moves to <strong>INZ_SUBMITTED</strong> and the client gets an email confirmation.
            </p>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">
              INZ reference number
            </label>
            <input
              type="text"
              value={inzApplicationNumber}
              onChange={(e) => setInzApplicationNumber(e.target.value)}
              placeholder="e.g. VRC-2026-NZL-12345"
              maxLength={128}
              disabled={submitting}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-3"
            />

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Submitted on <span className="font-normal text-[#4A4A4A]/50">(dd/mm/yyyy)</span></label>
            <div className="mb-3">
              <DateInput
                value={submittedAt || null}
                onChange={(iso) => setSubmittedAt(iso ?? '')}
                minYear={2015}
                maxYear={new Date().getFullYear()}
                disabled={submitting}
              />
            </div>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Payment receipt (required)</label>
            <input
              type="file"
              accept={ALLOWED_RECEIPT_MIMES.join(',')}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={submitting}
              className="w-full text-sm mb-1"
            />
            {file && (
              <div className="text-xs text-[#4A4A4A]/70 mb-3 flex items-center gap-1">
                <FileText size={12} /> {file.name} · {(file.size / 1024).toFixed(0)} KB
                {file.size > MAX_RECEIPT_BYTES && (
                  <span className="text-red-700 ml-1">— exceeds 10 MB limit</span>
                )}
                {!ALLOWED_RECEIPT_MIMES.includes(file.type as (typeof ALLOWED_RECEIPT_MIMES)[number]) && (
                  <span className="text-red-700 ml-1">— type not allowed</span>
                )}
              </div>
            )}
            <div className="text-xs text-[#4A4A4A]/60 mb-3">
              PDF, JPEG, PNG, or HEIC. Max 10 MB.
            </div>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              disabled={submitting}
              placeholder="Anything worth remembering about this submission…"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none resize-y disabled:bg-gray-50"
            />

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => (setOpen(false), reset())} disabled={submitting} className="min-h-[44px] px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="min-h-[44px] px-5 py-2 rounded-xl bg-[#F3CE49] text-[#1E3A5F] text-sm font-bold hover:bg-[#d4a615] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                {submitting ? 'Submitting…' : 'Submit to INZ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
