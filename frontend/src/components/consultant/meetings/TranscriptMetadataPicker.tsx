'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Upload, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// PR-DASH-3 — Transcript metadata picker.
//
// Matches the PR-13 / PR-14 / PR-DASH-2 pattern: client reads the
// File object, validates type + size, and PUTs only the metadata.
// File bytes never reach the backend.
//
// MIME whitelist + 25MB cap mirror the backend DTO so a rejection
// happens before the network round-trip.

const ACCEPTED_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
  'video/mp4',
  'video/webm',
  'text/plain',
  'text/vtt',
  'application/pdf',
];
const MAX_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_FILENAME_LEN = 255;

interface TranscriptMetadata {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function TranscriptMetadataPicker({
  meetingId,
  initial,
  onChanged,
}: {
  meetingId: string;
  initial: TranscriptMetadata | null;
  onChanged: () => void;
}) {
  const t = useTranslations();
  const [meta, setMeta] = useState<TranscriptMetadata | null>(initial);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onPick = async (file: File) => {
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      toast.error('Unsupported file type for transcript.');
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      toast.error('Transcript must be 25MB or smaller.');
      return;
    }
    if (file.name.length > MAX_FILENAME_LEN) {
      toast.error('Filename too long.');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/consultant/meetings/${meetingId}/transcript-metadata`, {
        originalFilename: file.name,
        mimeType:         file.type,
        sizeBytes:        file.size,
      });
      // Optimistic local update; parent will refresh authoritatively.
      setMeta({
        id:               'pending',
        originalFilename: file.name,
        mimeType:         file.type,
        sizeBytes:        file.size,
        uploadedAt:       new Date().toISOString(),
      });
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await api.delete(`/api/consultant/meetings/${meetingId}/transcript-metadata`);
      setMeta(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
        {t('meetings.transcript.title')}
      </p>
      {meta ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-sorena-navy/15 bg-sorena-navy/5 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-sorena-navy">
              {meta.originalFilename}
            </p>
            <p className="text-xs text-slate-500">
              {formatSize(meta.sizeBytes)} · {meta.mimeType}
            </p>
          </div>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            title={t('meetings.consultant.removeTranscript')}
            className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
          >
            <Trash2 size={14} className="inline" /> {t('meetings.consultant.removeTranscript')}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">
          {t('meetings.transcript.noFile')}
        </p>
      )}
      <div className="mt-3">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_MIME_TYPES.join(',')}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-sorena-navy/30 px-4 text-xs font-bold uppercase tracking-wide text-sorena-navy hover:bg-sorena-navy/5 disabled:opacity-40"
        >
          <Upload size={14} />
          {t('meetings.consultant.attachTranscript')}
        </button>
      </div>
    </div>
  );
}
