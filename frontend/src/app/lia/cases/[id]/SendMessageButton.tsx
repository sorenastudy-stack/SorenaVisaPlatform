'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, X, MessageSquarePlus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-4 — Send-message overlay. POST /cases/:id/messages.
//
// Optional "progress update" toggle promotes the message to a
// full-width navy-tinted broadcast on the client side. Otherwise
// it's a regular MESSAGE in the thread.

export function SendMessageButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [isProgress, setIsProgress] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedLen = body.trim().length;
  const canSubmit = trimmedLen >= 10 && trimmedLen <= 5000 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/cases/${caseId}/messages`, {
        body: body.trim(),
        ...(isProgress ? { kind: 'PROGRESS_UPDATE' } : {}),
      });
      setOpen(false);
      setBody('');
      setIsProgress(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to send message.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E3A5F] text-white text-sm font-semibold px-4 py-2.5 hover:bg-[#F3CE49] hover:text-[#1E3A5F] transition-colors"
      >
        <Send size={16} />
        Send message
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
                <h2 className="text-lg font-bold text-[#1E3A5F]">Send message to client</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
              Direct message to the client on this case. Encrypted at rest. Visible to the client on their dashboard.
            </p>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Message (min 10 chars)</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={5000}
              disabled={submitting}
              placeholder="Type your message…"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none resize-y disabled:bg-gray-50"
            />
            <div className="text-xs text-[#4A4A4A]/60 mt-1">{trimmedLen} / 5000</div>

            <label className="flex items-start gap-2 mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isProgress}
                onChange={(e) => setIsProgress(e.target.checked)}
                disabled={submitting}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-[#1E3A5F] focus:ring-[#1E3A5F]"
              />
              <span className="text-sm">
                <span className="font-medium text-[#1E3A5F]">Mark as progress update</span>
                <span className="block text-xs text-[#4A4A4A]/60">
                  Renders full-width on the client side with a navy banner.
                </span>
              </span>
            </label>

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={submitting} className="min-h-[48px] px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="min-h-[48px] px-5 py-2.5 rounded-xl bg-[#1E3A5F] text-white text-sm font-semibold hover:bg-[#F3CE49] hover:text-[#1E3A5F] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                {submitting ? '…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
