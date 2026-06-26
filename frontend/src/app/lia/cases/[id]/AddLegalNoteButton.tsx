'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquarePlus, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-1 — Add legal note overlay. POST /cases/:id/legal-notes.

export function AddLegalNoteButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedLen = body.trim().length;
  const canSubmit = trimmedLen >= 10 && trimmedLen <= 5000 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/cases/${caseId}/legal-notes`, { body: body.trim() });
      setOpen(false);
      setBody('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save note.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border-2 border-[#1E3A5F]/20 bg-[#FAF8F3] text-[#1E3A5F] text-sm font-semibold px-4 py-2.5 hover:border-[#1E3A5F]/50 transition-colors"
      >
        <MessageSquarePlus size={16} />
        Add legal note
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => (submitting ? null : setOpen(false))} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-[#1E3A5F]/10 flex items-center justify-center flex-shrink-0">
                  <MessageSquarePlus size={18} className="text-[#1E3A5F]" />
                </div>
                <h2 className="text-lg font-bold text-[#1E3A5F]">Add legal note</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
              Internal LIA note attached to this case. Encrypted at rest. Visible to LIA, ADMIN, and SUPER_ADMIN.
            </p>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Note (min 10 chars)</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={5000}
              disabled={submitting}
              placeholder="Type the note…"
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
              <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="min-h-[48px] px-5 py-2.5 rounded-xl bg-[#1E3A5F] text-white text-sm font-semibold hover:bg-[#F3CE49] hover:text-[#1E3A5F] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                {submitting ? '…' : 'Save note'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
