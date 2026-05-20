'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// PR-DASH-3 — Transcript notes editor.
//
// Textarea, autosave on blur (debounced 1s). "Saved" indicator
// flashes after a successful write. Notes are encrypted server-side
// before persisting.

export function TranscriptNotesEditor({
  meetingId,
  initial,
}: {
  meetingId: string;
  initial: string | null;
}) {
  const t = useTranslations();
  const [value, setValue] = useState<string>(initial ?? '');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>(initial ?? '');

  const save = async (next: string) => {
    if (next === lastSaved.current) return;
    setSaving(true);
    try {
      await api.put(`/api/consultant/meetings/${meetingId}/transcript-notes`, {
        transcriptNotes: next,
      });
      lastSaved.current = next;
      setSavedAt(Date.now());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const onChange = (next: string) => {
    setValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    // Debounced 1s autosave — saves while the consultant pauses
    // typing, not on every keystroke.
    timerRef.current = setTimeout(() => save(next), 1000);
  };

  // Cancel pending debounce on unmount so we don't fire after the
  // overlay closes.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
          {t('meetings.transcript.notes')}
        </p>
        <p className="text-xs text-slate-500">
          {saving
            ? 'Saving…'
            : savedAt
              ? `Saved ${new Date(savedAt).toLocaleTimeString()}`
              : ''}
        </p>
      </div>
      <textarea
        rows={8}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => save(value)}
        maxLength={50_000}
        placeholder={t('meetings.transcript.noNotes')}
        className="mt-2 w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy focus:outline-none"
      />
      <p className="mt-1 text-right text-xs text-slate-400">
        {value.length} / 50000
      </p>
    </div>
  );
}
