'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api';

// PR-VISA13 — Supporting documents picker (metadata only).
// File storage is deferred to a later PR. The browser extracts
// originalFilename / mimeType / sizeBytes from the File object and
// PUTs only those primitives to the backend. The file bytes are
// NEVER sent over the wire and NEVER stored anywhere.
//
// Replace-on-upload by documentType: the backend UNIQUE constraint
// on (visaApplicationId, documentType) ensures one row per type;
// the service deletes the existing row before inserting the new one
// in a single transaction.

export type DocumentType =
  | 'PASSPORT' | 'NATIONAL_ID' | 'RESIDENCE_VISA'
  | 'MILITARY_RECORD' | 'TRAVEL_HISTORY' | 'AUTHORITY_DOC';

export interface DocumentMetadata {
  documentType: DocumentType;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string | null;
}

const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

function formatSize(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
  void locale; // formatting is unit-suffix only; numeric locale formatting not required here.
}

interface Props {
  documentType: DocumentType;
  label: string;
  required?: boolean;
  helpText?: string;
  metadata: DocumentMetadata | null;
  // Parent receives the fresh server payload after upsert/delete so
  // every picker in the section stays in sync without a separate GET.
  onChange: (next: {
    livingInDifferentCountry: boolean | null;
    countryOfResidence: string | null;
    areAllDocsInEnglish: boolean | null;
    documents: DocumentMetadata[];
  }) => void;
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

  const onFile = async (file: File) => {
    setError(null);
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
      // File bytes never leave the browser. We extract only the three
      // primitives the backend persists as metadata.
      const next = await api.put<{
        livingInDifferentCountry: boolean | null;
        countryOfResidence: string | null;
        areAllDocsInEnglish: boolean | null;
        documents: DocumentMetadata[];
      }>('/students/me/visa/supporting-documents/metadata', {
        documentType,
        originalFilename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      onChange(next);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t('visaDocsValidationFileTooLarge'),
      );
    } finally {
      setBusy(false);
      // Reset the input so re-selecting the same file fires onChange.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onRemove = async () => {
    setError(null);
    setBusy(true);
    try {
      const next = await api.delete<{
        livingInDifferentCountry: boolean | null;
        countryOfResidence: string | null;
        areAllDocsInEnglish: boolean | null;
        documents: DocumentMetadata[];
      }>(`/students/me/visa/supporting-documents/metadata/${documentType}`);
      onChange(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '');
    } finally {
      setBusy(false);
    }
  };

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

      {metadata ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-sorena-navy/15 bg-sorena-navy/5 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-sorena-navy">
              {metadata.originalFilename}
            </p>
            <p className="text-xs text-sorena-navy/60">
              {formatSize(metadata.sizeBytes, 'en')}
            </p>
          </div>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            title={t('visaDocsPickerRemove')}
            className="flex items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
          >
            <Trash2 size={14} />
            {t('visaDocsPickerRemove')}
          </button>
        </div>
      ) : (
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
      )}

      {error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
