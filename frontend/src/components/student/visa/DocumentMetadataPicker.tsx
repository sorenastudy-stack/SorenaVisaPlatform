'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2, Upload, Download, RefreshCw } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-FILES-1 — Real file upload via the new POST .../file endpoint.
// The browser ships the bytes as multipart/form-data; the server
// returns the same shape as the legacy metadata endpoint (with an
// extra `hasFile` boolean per row). The legacy PUT .../metadata path
// is no longer called — uploads always carry bytes now.
//
// Drag-and-drop, click-to-browse, and replace are all wired into a
// single drop zone; download materialises a 5-minute signed URL on
// click and opens it in a new tab.
//
// The component name + props are preserved so Step 13 / Step 14 keep
// working without changes to their call sites.

export type DocumentType =
  | 'PASSPORT' | 'NATIONAL_ID' | 'RESIDENCE_VISA'
  | 'MILITARY_RECORD' | 'TRAVEL_HISTORY' | 'AUTHORITY_DOC'
  | 'OFFER_OF_PLACE' | 'PHD_RESEARCH_PROPOSAL' | 'PUBLICATIONS_LIST'
  | 'PERSONAL_CIRCUMSTANCES_EVIDENCE' | 'PREVIOUS_TERTIARY_EVIDENCE'
  | 'CURRENT_EMPLOYMENT_EVIDENCE' | 'PREVIOUS_EMPLOYMENT_EVIDENCE'
  | 'ENGLISH_TEST_RESULTS' | 'TUITION_PAYMENT_CONFIRMATION'
  | 'INZ1014_FINANCIAL_UNDERTAKING' | 'PREPAID_ACCOMMODATION_EVIDENCE'
  | 'SCHOLARSHIP_EVIDENCE' | 'OUTWARD_TRAVEL_EVIDENCE'
  | 'BANK_STATEMENTS' | 'EMPLOYMENT_INCOME_EVIDENCE'
  | 'SCHEDULED_HOLIDAY_EVIDENCE' | 'OTHER_EVIDENCE';

export interface DocumentMetadata {
  documentType: DocumentType;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string | null;
  // PR-FILES-1 — true once the server has the actual file bytes on
  // disk for this row. Legacy metadata-only rows (pre-PR-FILES-1)
  // will appear as false and can't be downloaded until re-uploaded.
  hasFile?: boolean;
}

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

interface ServerPayload {
  livingInDifferentCountry: boolean | null;
  countryOfResidence: string | null;
  areAllDocsInEnglish: boolean | null;
  documents: DocumentMetadata[];
}

interface Props {
  documentType: DocumentType;
  label: string;
  required?: boolean;
  helpText?: string;
  metadata: DocumentMetadata | null;
  onChange: (next: ServerPayload) => void;
  ariaInvalid?: boolean;
}

export function DocumentMetadataPicker({
  documentType,
  label,
  required,
  helpText,
  metadata,
  onChange,
  ariaInvalid,
}: Props) {
  const t = useTranslations();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const validate = (file: File): string | null => {
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      return t('visaDocsValidationFileType');
    }
    if (file.size > MAX_SIZE_BYTES) {
      return t('visaDocsValidationFileTooLarge');
    }
    return null;
  };

  const uploadFile = async (file: File) => {
    setError(null);
    const v = validate(file);
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const next = await api.upload<ServerPayload>(
        `/students/me/visa/supporting-documents/${documentType}/file`,
        fd,
      );
      onChange(next);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : t('visaDocsValidationFileTooLarge'),
      );
    } finally {
      setBusy(false);
      // Reset so re-selecting the same file fires onChange again.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onRemove = async () => {
    setError(null);
    setBusy(true);
    try {
      // DELETE clears both the metadata row AND the stored file path —
      // this is what the existing metadata endpoint already does
      // (it just deletes the row; the new fileUrl column goes with it).
      const next = await api.delete<ServerPayload>(
        `/students/me/visa/supporting-documents/metadata/${documentType}`,
      );
      onChange(next);
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
        `/students/me/visa/supporting-documents/${documentType}/download`,
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

  const hasFile = !!metadata?.hasFile;

  return (
    <div
      className={[
        'rounded-xl border bg-white p-4',
        ariaInvalid ? 'border-red-400' : 'border-sorena-navy/10',
      ].join(' ')}
    >
      <label className="mb-1 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {helpText && (
        <p className="mb-2 text-xs text-sorena-navy/50">{helpText}</p>
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

      {metadata ? (
        // ── Uploaded state ────────────────────────────────────────
        <div className="flex flex-col gap-2 rounded-lg border border-sorena-navy/15 bg-sorena-navy/5 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-sorena-navy">
                {hasFile ? '✓ ' : ''}{metadata.originalFilename}
              </p>
              <p className="text-xs text-sorena-navy/60">
                {formatSize(metadata.sizeBytes)}
              </p>
            </div>
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              title={t('visaDocsPickerRemove')}
              aria-label={t('visaDocsPickerRemove')}
              className="flex h-12 min-w-12 items-center justify-center gap-1 rounded-lg border border-red-300 px-3 text-xs font-bold uppercase tracking-wide text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasFile && (
              <button
                type="button"
                onClick={onDownload}
                disabled={busy}
                className="inline-flex h-12 items-center gap-1.5 rounded-lg border border-sorena-navy/30 bg-white px-3 text-xs font-bold uppercase tracking-wide text-sorena-navy transition-colors hover:border-sorena-gold hover:text-sorena-gold disabled:opacity-40"
              >
                <Download size={14} /> Download
              </button>
            )}
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
        // ── Empty drop zone ───────────────────────────────────────
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
            {busy
              ? 'Uploading…'
              : <>Drop a file here, or <span className="underline">browse</span></>}
          </p>
          <p className="text-xs text-sorena-navy/50">
            {t('visaDocsPickerAcceptedTypes')}
          </p>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
