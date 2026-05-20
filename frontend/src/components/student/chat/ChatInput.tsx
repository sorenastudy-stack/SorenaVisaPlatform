'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Send } from 'lucide-react';

// PR-DASH-4 — Chat input.
//
// Enter sends, Shift+Enter newlines. Disabled while the parent is
// awaiting an assistant reply. A subtle "Thinking…" indicator
// appears beneath the textarea during the wait — the spec calls
// for calm, not flashy.

const MAX_LEN = 4000;

export function ChatInput({
  busy,
  onSend,
}: {
  busy: boolean;
  onSend: (content: string) => void;
}) {
  const t = useTranslations();
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const canSend = value.trim() !== '' && value.length <= MAX_LEN && !busy;

  const submit = () => {
    if (!canSend) return;
    const out = value.trim();
    setValue('');
    onSend(out);
  };

  return (
    <div className="border-t border-slate-100 bg-white p-3 md:p-4">
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t('chat.input.placeholder')}
          maxLength={MAX_LEN + 100}
          disabled={busy}
          className="max-h-40 flex-1 resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-slate-400 focus:border-sorena-navy focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          aria-label={t('chat.input.send')}
          className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-sorena-navy text-white transition-colors hover:brightness-110 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy focus-visible:ring-offset-2"
        >
          <Send size={18} />
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <p className="text-xs text-slate-500" aria-live="polite">
          {busy ? t('chat.input.thinking') : ' '}
        </p>
        <p className={`text-xs ${value.length > MAX_LEN ? 'text-rose-600' : 'text-slate-400'}`}>
          {value.length} / {MAX_LEN}
        </p>
      </div>
    </div>
  );
}
