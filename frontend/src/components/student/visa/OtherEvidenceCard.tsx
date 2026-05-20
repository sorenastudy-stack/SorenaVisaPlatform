'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api';

// PR-VISA14 — Repeating "Other evidence" entry card.
// Mirrors DocumentMetadataPicker but writes to the other-evidence
// endpoint (which manages multiple rows per application) instead of
// the keyed metadata endpoint. customLabel is required when
// evidenceType = OTHER.

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
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

interface ServerPayload {
  otherEvidence: OtherEvidenceEntry[];
  // The full /supporting-documents-2 payload comes back on every
  // mutation. We only forward the entries here; the parent step
  // component swaps in the whole payload via its own state setter.
  [key: string]: unknown;
}

interface Props {
  entry: OtherEvidenceEntry;
  onServerChange: (next: ServerPayload) => void;
}

export function OtherEvidenceCard({ entry, onServerChange }: Props) {
  const t = useTranslations();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [evidenceType, setEvidenceType] = useState<OtherEvidenceType>(entry.evidenceType);
  const [customLabel, setCustomLabel] = useState<string>(entry.customLabel ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const persist = async (file?: File) => {
    setError(null);
    if (evidenceType === 'OTHER' && customLabel.trim() === '') {
      setError(t('visaDocs2ValidationCustomLabelRequired'));
      return;
    }
    let originalFilename = entry.originalFilename;
    let mimeType         = entry.mimeType;
    let sizeBytes        = entry.sizeBytes;
    if (file) {
      if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
        setError(t('visaDocsValidationFileType'));
        return;
      }
      if (file.size > MAX_SIZE_BYTES) {
        setError(t('visaDocsValidationFileTooLarge'));
        return;
      }
      originalFilename = file.name;
      mimeType         = file.type;
      sizeBytes        = file.size;
    }
    setBusy(true);
    try {
      const next = await api.put<ServerPayload>(
        '/students/me/visa/supporting-documents-2/other-evidence',
        {
          id: entry.id,
          evidenceType,
          customLabel: evidenceType === 'OTHER' ? customLabel.trim() : null,
          originalFilename,
          mimeType,
          sizeBytes,
        },
      );
      onServerChange(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '');
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
          className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
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
            // Persist immediately so the server has the latest type.
            // Reuses existing metadata; user can change file separately.
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                const next = await api.put<ServerPayload>(
                  '/students/me/visa/supporting-documents-2/other-evidence',
                  {
                    id: entry.id,
                    evidenceType: v,
                    customLabel: v === 'OTHER' ? customLabel.trim() : null,
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
            })();
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
            onBlur={() => { if (customLabel.trim() !== '' && customLabel !== (entry.customLabel ?? '')) persist(); }}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>
      )}

      <div className="rounded-lg border border-sorena-navy/15 bg-sorena-navy/5 px-3 py-2">
        <p className="truncate text-sm font-medium text-sorena-navy">
          {entry.originalFilename}
        </p>
        <p className="text-xs text-sorena-navy/60">{formatSize(entry.sizeBytes)}</p>
      </div>

      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) persist(f);
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-lg border border-sorena-navy/30 px-4 py-2 text-xs font-bold uppercase tracking-wide text-sorena-navy transition-colors hover:bg-sorena-navy/5 disabled:opacity-40"
        >
          {t('visaDocs2OtherEvidenceReplaceFile')}
        </button>
        <span className="text-xs text-sorena-navy/50">
          {t('visaDocsPickerAcceptedTypes')}
        </span>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// "Add another" form — picks evidenceType + file, then POSTs (via
// the same PUT endpoint with no id) so the server creates a new row.
export function OtherEvidenceAdder({
  onServerChange,
}: { onServerChange: (next: ServerPayload) => void }) {
  const t = useTranslations();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [evidenceType, setEvidenceType] = useState<OtherEvidenceType>('COVER_LETTER');
  const [customLabel, setCustomLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setError(null);
    if (evidenceType === 'OTHER' && customLabel.trim() === '') {
      setError(t('visaDocs2ValidationCustomLabelRequired'));
      return;
    }
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      setError(t('visaDocsValidationFileType'));
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError(t('visaDocsValidationFileTooLarge'));
      return;
    }
    setBusy(true);
    try {
      const next = await api.put<ServerPayload>(
        '/students/me/visa/supporting-documents-2/other-evidence',
        {
          evidenceType,
          customLabel: evidenceType === 'OTHER' ? customLabel.trim() : null,
          originalFilename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        },
      );
      onServerChange(next);
      setCustomLabel('');
      setEvidenceType('COVER_LETTER');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
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
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-lg border border-sorena-navy/30 px-4 py-2 text-xs font-bold uppercase tracking-wide text-sorena-navy transition-colors hover:bg-sorena-navy/5 disabled:opacity-40"
        >
          {t('visaDocsPickerBrowse')}
        </button>
        <span className="text-xs text-sorena-navy/50">
          {t('visaDocsPickerAcceptedTypes')}
        </span>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
