'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-10 — Author-only observation deletion.
// Per Decision 2C, observations are append-only — but the author can
// retract their own. The parent page only renders this button when
// the viewer's session.userId === observation.authorId.

export function DeleteObservationButton({
  officerId,
  observationId,
}: {
  officerId: string;
  observationId: string;
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
      await api.delete(`/officers/${officerId}/observations/${observationId}`);
      close();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete observation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Delete your observation"
        className="inline-flex items-center gap-1 text-xs text-[#4A4A4A]/60 hover:text-red-700 transition-colors"
      >
        <Trash2 size={12} /> Delete
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-xl p-6">
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-lg font-bold text-red-800">Delete observation?</h2>
              <button type="button" onClick={close} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
              This permanently removes your observation from the officer's timeline. The audit log keeps a record of the deletion.
            </p>

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={close} disabled={submitting} className="min-h-[44px] px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={submitting} className="min-h-[44px] px-5 py-2 rounded-xl bg-red-700 text-white text-sm font-semibold hover:bg-red-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                {submitting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
