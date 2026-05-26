'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquarePlus, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-10 — Add observation to an officer.
// Per Decision 2C, observations are attributed and append-only. The
// backend records the author from JWT; this UI only collects body + tags.

export function AddObservationButton({ officerId }: { officerId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bodyLen = body.trim().length;
  const canSubmit = bodyLen >= 10 && bodyLen <= 5000 && !submitting;

  const close = () => {
    if (submitting) return;
    setOpen(false);
    setBody('');
    setTags('');
    setError(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const tagArr = tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .slice(0, 20);
      await api.post(`/officers/${officerId}/observations`, {
        body: body.trim(),
        tags: tagArr.length > 0 ? tagArr : undefined,
      });
      close();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to add observation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#1E3A5F] text-white text-sm font-bold px-4 py-2 hover:bg-[#E8B923] hover:text-[#1E3A5F] transition-colors"
      >
        <MessageSquarePlus size={16} />
        Add observation
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-[#1E3A5F]/10 flex items-center justify-center flex-shrink-0">
                  <MessageSquarePlus size={18} className="text-[#1E3A5F]" />
                </div>
                <h2 className="text-lg font-bold text-[#1E3A5F]">Add observation</h2>
              </div>
              <button type="button" onClick={close} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
              Observations are attributed to you and cannot be edited after posting. You can delete your own.
            </p>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">
              Observation (10–5000 chars)
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={5000}
              disabled={submitting}
              placeholder="Share an insight, pattern, or institutional knowledge about this officer…"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none resize-y disabled:bg-gray-50"
            />
            <div className="text-xs text-[#4A4A4A]/60 mt-1 mb-3">{bodyLen} / 5000</div>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">
              Tags (comma-separated, optional)
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              disabled={submitting}
              placeholder="e.g. financial-scrutiny, fast-decision"
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50"
            />
            <div className="text-xs text-[#4A4A4A]/60 mt-1">Up to 20 tags.</div>

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={close} disabled={submitting} className="min-h-[44px] px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="min-h-[44px] px-5 py-2 rounded-xl bg-[#1E3A5F] text-white text-sm font-bold hover:bg-[#E8B923] hover:text-[#1E3A5F] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                {submitting ? 'Posting…' : 'Post observation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
