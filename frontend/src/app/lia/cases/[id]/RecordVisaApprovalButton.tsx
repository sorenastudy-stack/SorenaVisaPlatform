'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, X, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-8 — "Record Approval" overlay.
//
// Multipart upload to POST /cases/:id/visa/issue. Captures visa
// start/end dates + the visa PDF + optional notes. On success the
// case transitions INZ_SUBMITTED → COMPLETED with an approved visa
// record; the client gets a "your visa has been issued" email
// (best-effort, never blocks).

const ALLOWED_VISA_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
] as const;

const MAX_VISA_BYTES = 10 * 1024 * 1024;

export function RecordVisaApprovalButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [visaStartDate, setVisaStartDate] = useState('');
  const [visaEndDate, setVisaEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const datesValid =
    visaStartDate !== '' &&
    visaEndDate !== '' &&
    visaStartDate <= visaEndDate &&
    visaEndDate > today;
  const fileValid =
    !!file &&
    ALLOWED_VISA_MIMES.includes(file.type as (typeof ALLOWED_VISA_MIMES)[number]) &&
    file.size <= MAX_VISA_BYTES;
  const canSubmit = datesValid && fileValid && !submitting;

  const reset = () => {
    setVisaStartDate('');
    setVisaEndDate('');
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
      fd.append('visaStartDate', new Date(visaStartDate + 'T00:00:00').toISOString());
      fd.append('visaEndDate', new Date(visaEndDate + 'T00:00:00').toISOString());
      if (notes.trim()) fd.append('notes', notes.trim());
      await api.upload(`/cases/${caseId}/visa/issue`, fd);
      setOpen(false);
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to record visa approval.');
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
        <CheckCircle2 size={16} />
        Record approval
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => (submitting ? null : (setOpen(false), reset()))} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 size={18} className="text-emerald-700" />
                </div>
                <h2 className="text-lg font-bold text-[#1E3A5F]">Record visa approval</h2>
              </div>
              <button type="button" onClick={() => (setOpen(false), reset())} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
              Capture the visa start/end dates and attach the visa document. The case moves to <strong>COMPLETED</strong> and the client receives an "your visa has been issued" email.
            </p>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Visa start date</label>
            <input
              type="date"
              value={visaStartDate}
              onChange={(e) => setVisaStartDate(e.target.value)}
              disabled={submitting}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-3"
            />

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Visa end date</label>
            <input
              type="date"
              value={visaEndDate}
              onChange={(e) => setVisaEndDate(e.target.value)}
              disabled={submitting}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-1"
            />
            {visaStartDate && visaEndDate && visaStartDate > visaEndDate && (
              <div className="text-xs text-red-700 mb-3">End date must be on or after start date.</div>
            )}
            {visaEndDate && visaEndDate <= today && (
              <div className="text-xs text-red-700 mb-3">End date must be in the future.</div>
            )}
            <div className={visaStartDate && visaEndDate && visaStartDate <= visaEndDate && visaEndDate > today ? 'mb-3' : 'mb-0'} />

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Visa document (required)</label>
            <input
              type="file"
              accept={ALLOWED_VISA_MIMES.join(',')}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={submitting}
              className="w-full text-sm mb-1"
            />
            {file && (
              <div className="text-xs text-[#4A4A4A]/70 mb-3 flex items-center gap-1">
                <FileText size={12} /> {file.name} · {(file.size / 1024).toFixed(0)} KB
                {file.size > MAX_VISA_BYTES && (
                  <span className="text-red-700 ml-1">— exceeds 10 MB limit</span>
                )}
                {!ALLOWED_VISA_MIMES.includes(file.type as (typeof ALLOWED_VISA_MIMES)[number]) && (
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
              placeholder="Conditions, entry restrictions, anything to remember…"
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
                {submitting ? 'Recording…' : 'Record approval'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
