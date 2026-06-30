'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Edit, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { DateInput } from '@/components/ui/DateInput';

// PR-LIA-8 — In-place edit of a visa record.
//
// What's editable depends on the row's outcome:
//   APPROVED: visaStartDate, visaEndDate, notes
//   DECLINED: declineReason (re-encrypted), notes
// The visa file itself is NOT editable here (revert + reissue if
// needed — matches PR-LIA-7's edit pattern).

export function EditVisaRecordButton({
  caseId,
  outcome,
  currentStart,
  currentEnd,
  currentDeclineReason,
  currentNotes,
}: {
  caseId: string;
  outcome: 'APPROVED' | 'DECLINED';
  currentStart: string | null;
  currentEnd: string | null;
  currentDeclineReason: string | null;
  currentNotes: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(currentStart ? currentStart.slice(0, 10) : '');
  const [endDate, setEndDate] = useState(currentEnd ? currentEnd.slice(0, 10) : '');
  const [declineReason, setDeclineReason] = useState(currentDeclineReason ?? '');
  const [notes, setNotes] = useState(currentNotes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStartDate(currentStart ? currentStart.slice(0, 10) : '');
    setEndDate(currentEnd ? currentEnd.slice(0, 10) : '');
    setDeclineReason(currentDeclineReason ?? '');
    setNotes(currentNotes ?? '');
    setError(null);
  };

  const startChanged = outcome === 'APPROVED' && startDate !== (currentStart?.slice(0, 10) ?? '');
  const endChanged = outcome === 'APPROVED' && endDate !== (currentEnd?.slice(0, 10) ?? '');
  const declineChanged = outcome === 'DECLINED' && declineReason.trim() !== (currentDeclineReason ?? '');
  const notesChanged = notes.trim() !== (currentNotes ?? '');
  const anyChange = startChanged || endChanged || declineChanged || notesChanged;

  const datesValid =
    outcome !== 'APPROVED' ||
    (startDate !== '' && endDate !== '' && startDate <= endDate);
  const reasonValid =
    outcome !== 'DECLINED' ||
    (declineReason.trim().length >= 10 && declineReason.trim().length <= 5000);
  const canSubmit = anyChange && datesValid && reasonValid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (startChanged) body.visaStartDate = new Date(startDate + 'T00:00:00').toISOString();
      if (endChanged) body.visaEndDate = new Date(endDate + 'T00:00:00').toISOString();
      if (declineChanged) body.declineReason = declineReason.trim();
      if (notesChanged) body.notes = notes.trim();
      await api.patch(`/cases/${caseId}/visa`, body);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to update visa record.');
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
        Edit visa record
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
                <h2 className="text-lg font-bold text-[#1E3A5F]">Edit visa record</h2>
              </div>
              <button type="button" onClick={() => (setOpen(false), reset())} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
              {outcome === 'APPROVED'
                ? 'Fix a typo in the dates or update internal notes. The visa document itself is read-only — to swap it, revert and re-issue.'
                : 'Edit the confidential decline reason or update internal notes. To switch outcomes (decline → approval) you need to revert + re-record.'}
            </p>

            {outcome === 'APPROVED' && (
              <>
                <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Visa start date <span className="font-normal text-[#4A4A4A]/50">(dd/mm/yyyy)</span></label>
                <div className="mb-3">
                  <DateInput
                    value={startDate || null}
                    onChange={(iso) => setStartDate(iso ?? '')}
                    minYear={new Date().getFullYear() - 1}
                    maxYear={new Date().getFullYear() + 15}
                    disabled={submitting}
                  />
                </div>

                <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Visa end date <span className="font-normal text-[#4A4A4A]/50">(dd/mm/yyyy)</span></label>
                <div className="mb-3">
                  <DateInput
                    value={endDate || null}
                    onChange={(iso) => setEndDate(iso ?? '')}
                    minYear={new Date().getFullYear() - 1}
                    maxYear={new Date().getFullYear() + 15}
                    disabled={submitting}
                  />
                </div>
                {startDate && endDate && startDate > endDate && (
                  <div className="text-xs text-red-700 mb-3">End date must be on or after start date.</div>
                )}
              </>
            )}

            {outcome === 'DECLINED' && (
              <>
                <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">
                  Decline reason (confidential, 10–5000 chars)
                </label>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  rows={6}
                  maxLength={5000}
                  disabled={submitting}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none resize-y disabled:bg-gray-50 mb-3"
                />
              </>
            )}

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
