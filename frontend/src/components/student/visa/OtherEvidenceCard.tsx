'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2, Upload, Download, RefreshCw } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-FILES-1 — Step-14 repeating other-evidence entries now ship
// real file bytes. Existing entries get drag-drop replace + download
// via POST .../other-evidence/:entryId/file. The Adder creates a row
// via the existing PUT .../other-evidence metadata endpoint, then
// immediately POSTs the file to the new entry id — one user gesture,
// two backend calls, atomic-ish (a failed second call leaves the
// metadata row in place so the card's upload control can recover).

export type OtherEvidenceType =
  | 'COVER_LETTER' | 'STATEMENT_OF_PURPOSE'
  | 'ADDITIONAL_FUNDS_EVIDENCE' | 'FAMILY_TIES_EVIDENCE' | 'OTHER';

const TYPES: OtherEvidenceType[] = [
  'COVER_LETTER',
  'STATEMENT_OF_PURPOSE',
  'ADDITIONAL_FUNDS_EVIDENCE',
  'FAMILY_TIES_EVIDENCE',
  'OTHER',
];

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

export interface OtherEvidenceEntry {
  id: string;
  evidenceType: OtherEvidenceType;
  customLabel: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string | null;
  hasFile?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

interface ServerPayload {
  otherEvidence: OtherEvidenceEntry[];
  [key: string]: unknown;
}

function validateFile(file: File, t: ReturnType<typeof useTranslations>): string | null {
  if (!ACCEPTED_MIME_TYPES.includes(file.type)) return t('visaDocsValidationFileType');
  if (file.size > MAX_SIZE_BYTES) return t('visaDocsValidationFileTooLarge');
  return null;
}

interface CardProps {
  entry: OtherEvidenceEntry;
  onServerChange: (next: ServerPayload) => void;
}

export function OtherEvidenceCard({ entry, onServerChange }: CardProps) {
  const t = useTranslations();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [evidenceType, setEvidenceType] = useState<OtherEvidenceType>(entry.evidenceType);
  const [customLabel, setCustomLabel] = useState<string>(entry.customLabel ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Persist type/customLabel changes via the metadata endpoint —
  // file unchanged. Filename / size / mime stay as they are so the
  // backend's update path doesn't fight us on bytes that already
  // exist on disk.
  const persistMetadata = async (overrides?: Partial<{ evidenceType: OtherEvidenceType; customLabel: string }>) => {
    setError(null);
    const nextType = overrides?.evidenceType ?? evidenceType;
    const nextLabel = overrides?.customLabel ?? customLabel;
    if (nextType === 'OTHER' && nextLabel.trim() === '') {
      setError(t('visaDocs2ValidationCustomLabelRequired'));
      return;
    }
    setBusy(true);
    try {
      const next = await api.put<ServerPayload>(
        '/students/me/visa/supporting-documents-2/other-evidence',
        {
          id: entry.id,
          evidenceType: nextType,
          customLabel: nextType === 'OTHER' ? nextLabel.trim() : null,
          originalFilename: entry.originalFilename,
          mimeType: entry.mimeType,
          sizeBytes: entry.sizeBytes,
        },
      );
      onServerChange(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '');
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (file: File) => {
    setError(null);
    const v = validateFile(file, t);
    if (v) {
      setError(v);
      return;
    }
    if (evidenceType === 'OTHER' && customLabel.trim() === '') {
      setError(t('visaDocs2ValidationCustomLabelRequired'));
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const next = await api.upload<ServerPayload>(
        `/students/me/visa/supporting-documents-2/other-evidence/${entry.id}/file`,
        fd,
      );
      onServerChange(next);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : (caught instanceof Error ? caught.message : ''));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onRemove = async () => {
    setError(null);
    setBusy(true);
    try {
      const next = await api.delete<ServerPayload>(
        `/students/me/visa/supporting-documents-2/other-evidence/${entry.id}`,
      );
      onServerChange(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '');
    } finally {
      setBusy(false);
    }
  };

  const onDownload = async () => {
    setError(null);
    try {
      const { url } = await api.get<{ url: string; expiresInSeconds: number }>(
        `/students/me/visa/supporting-documents-2/other-evidence/${entry.id}/download`,
      );
      const absolute = url.startsWith('http') ? url : `${API_URL}${url}`;
      window.open(absolute, '_blank', 'noopener');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to open file.');
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  };

  const hasFile = !!entry.hasFile;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-sorena-navy/10 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
          {t(`visaDocs2EvidenceType_${entry.evidenceType}` as Parameters<typeof t>[0])}
        </h4>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          title={t('visaDocs2OtherEvidenceRemove')}
          aria-label={t('visaDocs2OtherEvidenceRemove')}
          className="flex h-10 min-w-10 items-center justify-center rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaDocs2EvidenceTypeLabel')}
        </label>
        <select
          value={evidenceType}
          onChange={(e) => {
            const v = e.target.value as OtherEvidenceType;
            setEvidenceType(v);
            void persistMetadata({ evidenceType: v });
          }}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
        >
          {TYPES.map((tp) => (
            <option key={tp} value={tp}>
              {t(`visaDocs2EvidenceType_${tp}` as Parameters<typeof t>[0])}
            </option>
          ))}
        </select>
      </div>

      {evidenceType === 'OTHER' && (
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaDocs2CustomLabelLabel')}
            <span className="ml-0.5 text-red-500">*</span>
          </label>
          <input
            type="text"
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            onBlur={() => { if (customLabel.trim() !== '' && customLabel !== (entry.customLabel ?? '')) void persistMetadata(); }}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void uploadFile(f);
        }}
        className="hidden"
      />

      {hasFile ? (
        // ── Uploaded state ────────────────────────────────────────
        <div className="flex flex-col gap-2 rounded-lg border border-sorena-navy/15 bg-sorena-navy/5 px-3 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-sorena-navy">
              ✓ {entry.originalFilename}
            </p>
            <p className="text-xs text-sorena-navy/60">{formatSize(entry.sizeBytes)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onDownload}
              disabled={busy}
              className="inline-flex h-12 items-center gap-1.5 rounded-lg border border-sorena-navy/30 bg-white px-3 text-xs font-bold uppercase tracking-wide text-sorena-navy transition-colors hover:border-sorena-gold hover:text-sorena-gold disabled:opacity-40"
            >
              <Download size={14} /> Download
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="inline-flex h-12 items-center gap-1.5 rounded-lg border border-sorena-navy/30 bg-white px-3 text-xs font-bold uppercase tracking-wide text-sorena-navy transition-colors hover:bg-sorena-navy/5 disabled:opacity-40"
            >
              <RefreshCw size={14} /> {busy ? '…' : 'Replace'}
            </button>
          </div>
        </div>
      ) : (
        // ── Empty drop zone for entries that exist without a file ─
        <div
          role="button"
          tabIndex={0}
          onClick={() => { if (!busy) inputRef.current?.click(); }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !busy) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          aria-disabled={busy}
          className={[
            'flex min-h-[6rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-4 text-center transition-colors',
            dragOver
              ? 'border-sorena-gold bg-sorena-gold/5'
              : 'border-sorena-navy/25 bg-white hover:border-sorena-navy/45 hover:bg-sorena-navy/[0.03]',
            busy ? 'cursor-not-allowed opacity-60' : '',
          ].join(' ')}
        >
          <Upload size={20} className="text-sorena-navy/50" />
          <p className="text-sm font-semibold text-sorena-navy">
            {busy ? 'Uploading…' : <>Drop a file here, or <span className="underline">browse</span></>}
          </p>
          <p className="text-xs text-sorena-navy/50">
            {t('visaDocsPickerAcceptedTypes')}
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// "Add another" form — picks evidenceType + (optional customLabel) +
// a file. Creates the row via PUT metadata, then POSTs the file to
// the freshly-minted entry id. The new id is found by diffing the
// otherEvidence array before/after the metadata call.
interface AdderProps {
  onServerChange: (next: ServerPayload) => void;
  currentEntries: OtherEvidenceEntry[];
}

export function OtherEvidenceAdder({ onServerChange, currentEntries }: AdderProps) {
  const t = useTranslations();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [evidenceType, setEvidenceType] = useState<OtherEvidenceType>('COVER_LETTER');
  const [customLabel, setCustomLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const onFile = async (file: File) => {
    setError(null);
    if (evidenceType === 'OTHER' && customLabel.trim() === '') {
      setError(t('visaDocs2ValidationCustomLabelRequired'));
      return;
    }
    const v = validateFile(file, t);
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    try {
      // Step 1: create the metadata row. Backend keys uniqueness on
      // (visaApplicationId, id-via-create) — no UNIQUE on type — so
      // multiple rows can share an evidenceType.
      const afterMeta = await api.put<ServerPayload>(
        '/students/me/visa/supporting-documents-2/other-evidence',
        {
          evidenceType,
          customLabel: evidenceType === 'OTHER' ? customLabel.trim() : null,
          originalFilename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        },
      );
      // Find the new entry: the one in afterMeta that wasn't in
      // currentEntries. Fallback: pick the entry with the latest
      // uploadedAt (in case the prior list is stale).
      const beforeIds = new Set(currentEntries.map((e) => e.id));
      let newEntry = afterMeta.otherEvidence.find((e) => !beforeIds.has(e.id));
      if (!newEntry && afterMeta.otherEvidence.length > 0) {
        newEntry = [...afterMeta.otherEvidence].sort(
          (a, b) => new Date(b.uploadedAt ?? 0).getTime() - new Date(a.uploadedAt ?? 0).getTime(),
        )[0];
      }
      if (!newEntry) {
        // Should never happen — server just inserted a row — but be
        // defensive so we don't silently lose the file.
        onServerChange(afterMeta);
        setError('Created entry but could not locate it for file upload. Please use Replace on the new card.');
        return;
      }

      // Step 2: upload the file to the new entry.
      const fd = new FormData();
      fd.append('file', file);
      const final = await api.upload<ServerPayload>(
        `/students/me/visa/supporting-documents-2/other-evidence/${newEntry.id}/file`,
        fd,
      );
      onServerChange(final);
      setCustomLabel('');
      setEvidenceType('COVER_LETTER');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void onFile(file);
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-sorena-navy/30 bg-white p-4">
      <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
        {t('visaDocs2OtherEvidenceAddAnother')}
      </h4>
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaDocs2EvidenceTypeLabel')}
        </label>
        <select
          value={evidenceType}
          onChange={(e) => setEvidenceType(e.target.value as OtherEvidenceType)}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
        >
          {TYPES.map((tp) => (
            <option key={tp} value={tp}>
              {t(`visaDocs2EvidenceType_${tp}` as Parameters<typeof t>[0])}
            </option>
          ))}
        </select>
      </div>
      {evidenceType === 'OTHER' && (
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaDocs2CustomLabelLabel')}
            <span className="ml-0.5 text-red-500">*</span>
          </label>
          <input
            type="text"
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
        className="hidden"
      />

      <div
        role="button"
        tabIndex={0}
        onClick={() => { if (!busy) inputRef.current?.click(); }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        aria-disabled={busy}
        className={[
          'flex min-h-[6rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-4 text-center transition-colors',
          dragOver
            ? 'border-sorena-gold bg-sorena-gold/5'
            : 'border-sorena-navy/25 bg-white hover:border-sorena-navy/45 hover:bg-sorena-navy/[0.03]',
          busy ? 'cursor-not-allowed opacity-60' : '',
        ].join(' ')}
      >
        <Upload size={20} className="text-sorena-navy/50" />
        <p className="text-sm font-semibold text-sorena-navy">
          {busy ? 'Uploading…' : <>Drop a file here, or <span className="underline">browse</span></>}
        </p>
        <p className="text-xs text-sorena-navy/50">
          {t('visaDocsPickerAcceptedTypes')}
        </p>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
