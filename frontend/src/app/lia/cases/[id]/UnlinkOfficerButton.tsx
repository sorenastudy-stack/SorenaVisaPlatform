'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Unlink, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-10 — Unlink the reviewing officer from this case.
// Simple confirmation overlay; the backend writes an audit row.

export function UnlinkOfficerButton({
  caseId,
  officerName,
}: {
  caseId: string;
  officerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (submitting) return;
    setOpen(false);
    setError(null);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.delete(`/cases/${caseId}/officer-linkage`);
      close();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to unlink officer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-[#4A4A4A] text-xs font-semibold px-3 py-1.5 hover:border-red-300 hover:text-red-700 transition-colors"
      >
        <Unlink size={12} />
        Unlink
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-xl p-6">
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-lg font-bold text-[#1E3A5F]">Unlink reviewing officer?</h2>
              <button type="button" onClick={close} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
              This removes the link to <strong>{officerName}</strong> for this case. The officer's profile and observations stay intact. You can re-link the same officer (or a different one) afterwards.
            </p>

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={close} disabled={submitting} className="min-h-[44px] px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={submitting} className="min-h-[44px] px-5 py-2 rounded-xl bg-red-700 text-white text-sm font-semibold hover:bg-red-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                {submitting ? 'Unlinking…' : 'Unlink officer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
