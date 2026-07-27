'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-4 — Client-side reply composer. POST /students/me/case-messages.

export function ReplyComposer() {
  const router = useRouter();
  const t = useTranslations('caseMessages.composer');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedLen = body.trim().length;
  const canSend = trimmedLen >= 10 && trimmedLen <= 5000 && !submitting;

  const handleSend = async () => {
    if (!canSend) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/students/me/case-messages', { body: body.trim() });
      setBody('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('sendError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        maxLength={5000}
        disabled={submitting}
        placeholder={t('placeholder')}
        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none resize-y disabled:bg-gray-50"
      />
      <div className="text-xs text-[#4A4A4A]/60 mt-1">{t('counter', { count: trimmedLen })}</div>

      {error && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className="min-h-[48px] inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#1E3A5F] text-white text-sm font-semibold hover:bg-[#c9a961] hover:text-[#1E3A5F] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
        >
          <Send size={14} />
          {submitting ? t('sending') : t('send')}
        </button>
      </div>
    </div>
  );
}
