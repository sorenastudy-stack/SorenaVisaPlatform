'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2, Upload, Download, Loader2, AlertCircle, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-FILES-2 — Multi-file picker for a single document REQUIREMENT.
// Each parent VisaSupportingDocument requirement can now hold many
// child VisaSupportingDocumentFile rows. The UI renders:
//   1. The list of currently uploaded files (with download + delete
//      per file).
//   2. An always-visible drop zone below so more can be added.
//
// Each drop / browse selection can include MULTIPLE files; each file
// becomes its own per-file POST. Per-file progress + errors are
// tracked in local state. Delete opens an inline confirm modal
// (project convention — NOT a shadcn Dialog) and updates optimistically.

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

export interface VisaDocumentFile {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface DocumentMetadata {
  id: string;
  documentType: DocumentType;
  files: VisaDocumentFile[];
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

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${min}`;
}

export interface ServerPayload {
  livingInDifferentCountry: boolean | null;
  countryOfResidence: string | null;
  areAllDocsInEnglish: boolean | null;
  documents: DocumentMetadata[];
}

interface PendingUpload {
  localId: string;
  name: string;
  status: 'uploading' | 'error';
  error?: string;
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
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<VisaDocumentFile | null>(null);
  const [topError, setTopError] = useState<string | null>(null);

  const files = metadata?.files ?? [];
  const visibleFiles = files.filter((f) => !deletingIds.has(f.id));

  const validate = (file: File): string | null => {
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      return t('visaDocsValidationFileType');
    }
    if (file.size > MAX_SIZE_BYTES) {
      return t('visaDocsValidationFileTooLarge');
    }
    return null;
  };

  const removePending = (localId: string) =>
    setPending((p) => p.filter((x) => x.localId !== localId));

  const setPendingStatus = (localId: string, patch: Partial<PendingUpload>) =>
    setPending((p) => p.map((x) => (x.localId === localId ? { ...x, ...patch } : x)));

  // Multi-file upload: validate each up front, then POST in parallel.
  // Invalid files surface inline (as error-state pending rows) without
  // blocking the valid ones.
  const uploadMany = (chosen: File[]) => {
    setTopError(null);
    if (chosen.length === 0) return;
    const accepted: Array<{ localId: string; file: File }> = [];
    const rejected: PendingUpload[] = [];
    for (const f of chosen) {
      const v = validate(f);
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (v) {
        rejected.push({ localId, name: f.name, status: 'error', error: v });
      } else {
        accepted.push({ localId, file: f });
      }
    }
    if (rejected.length > 0) {
      setPending((p) => [...p, ...rejected]);
    }
    if (accepted.length === 0) return;
    setPending((p) => [
      ...p,
      ...accepted.map(({ localId, file }) => ({
        localId,
        name: file.name,
        status: 'uploading' as const,
      })),
    ]);
    // POST each accepted file in parallel.
    for (const { localId, file } of accepted) {
      void (async () => {
        try {
          const fd = new FormData();
          fd.append('file', file);
          const next = await api.upload<ServerPayload>(
            `/students/me/visa/supporting-documents/${documentType}/file`,
            fd,
          );
          // Parent now holds the freshly persisted file in its
          // documents[].files; remove the pending row.
          onChange(next);
          removePending(localId);
        } catch (caught) {
          setPendingStatus(localId, {
            status: 'error',
            error:
              caught instanceof ApiError
                ? caught.message
                : caught instanceof Error
                  ? caught.message
                  : 'Upload failed',
          });
        }
      })();
    }
  };

  const onDownload = async (file: VisaDocumentFile) => {
    setTopError(null);
    try {
      const { url } = await api.get<{ url: string; expiresInSeconds: number }>(
        `/students/me/visa/supporting-documents/files/${file.id}/download`,
      );
      const absolute = url.startsWith('http') ? url : `${API_URL}${url}`;
      window.open(absolute, '_blank', 'noopener');
    } catch (caught) {
      setTopError(caught instanceof ApiError ? caught.message : 'Failed to open file.');
    }
  };

  const onConfirmDelete = async () => {
    if (!confirmDelete) return;
    const file = confirmDelete;
    setConfirmDelete(null);
    // Optimistic: hide the row immediately.
    setDeletingIds((s) => new Set(s).add(file.id));
    try {
      const next = await api.delete<ServerPayload>(
        `/students/me/visa/supporting-documents/files/${file.id}`,
      );
      onChange(next);
      // Server payload now lacks this file; clearing deletingIds is
      // cosmetic but cheap.
      setDeletingIds((s) => {
        const n = new Set(s);
        n.delete(file.id);
        return n;
      });
    } catch (caught) {
      // Restore the row + surface error.
      setDeletingIds((s) => {
        const n = new Set(s);
        n.delete(file.id);
        return n;
      });
      setTopError(
        caught instanceof ApiError ? caught.message : 'Failed to delete file.',
      );
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files ?? []);
    if (dropped.length > 0) uploadMany(dropped);
  };

  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length > 0) uploadMany(picked);
    if (inputRef.current) inputRef.current.value = '';
  };

  // The drop-zone borders shift on drag-over to the brand-gold accent.
  // aria-invalid is reflected on the container border so the parent
  // form's validation highlight still works.
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
        multiple
        onChange={onPicked}
        className="hidden"
      />

      {/* File list — one row per persisted file, plus pending rows. */}
      {(visibleFiles.length > 0 || pending.length > 0) && (
        <ul className="mb-3 flex flex-col gap-2">
          {visibleFiles.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 rounded-lg border border-sorena-navy/15 bg-sorena-navy/5 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-sorena-navy">
                  {f.originalFilename}
                </p>
                <p className="text-xs text-sorena-navy/60">
                  {formatSize(f.sizeBytes)} · {formatTime(f.uploadedAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDownload(f)}
                title={`Download ${f.originalFilename}`}
                aria-label={`Download ${f.originalFilename}`}
                className="flex h-12 min-w-12 items-center justify-center rounded-lg border border-sorena-navy/30 bg-white text-sorena-navy transition-colors hover:border-sorena-gold hover:text-sorena-gold"
              >
                <Download size={16} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(f)}
                title={`Delete ${f.originalFilename}`}
                aria-label={`Delete ${f.originalFilename}`}
                className="flex h-12 min-w-12 items-center justify-center rounded-lg border border-red-300 bg-white text-red-600 transition-colors hover:bg-red-50"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
          {pending.map((p) => (
            <li
              key={p.localId}
              className={[
                'flex items-center gap-3 rounded-lg border px-3 py-2',
                p.status === 'error'
                  ? 'border-red-200 bg-red-50'
                  : 'border-sorena-navy/15 bg-sorena-navy/[0.03]',
              ].join(' ')}
            >
              {p.status === 'uploading' ? (
                <Loader2 size={16} className="shrink-0 animate-spin text-sorena-navy/60" />
              ) : (
                <AlertCircle size={16} className="shrink-0 text-red-500" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-sorena-navy">
                  {p.name}
                </p>
                <p className="text-xs text-sorena-navy/60">
                  {p.status === 'uploading' ? 'Uploading…' : p.error}
                </p>
              </div>
              {p.status === 'error' && (
                <button
                  type="button"
                  onClick={() => removePending(p.localId)}
                  title="Dismiss"
                  aria-label="Dismiss"
                  className="flex h-10 min-w-10 items-center justify-center rounded text-sorena-navy/50 hover:bg-sorena-navy/5"
                >
                  <X size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Always-visible drop zone — same gold-on-drag highlight as PR-FILES-1. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={[
          'flex min-h-[5rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-3 text-center transition-colors',
          dragOver
            ? 'border-sorena-gold bg-sorena-gold/5'
            : 'border-sorena-navy/25 bg-white hover:border-sorena-navy/45 hover:bg-sorena-navy/[0.03]',
        ].join(' ')}
      >
        <Upload size={18} className="text-sorena-navy/50" />
        <p className="text-sm font-semibold text-sorena-navy">
          {visibleFiles.length === 0
            ? <>Drop files here, or <span className="underline">browse</span></>
            : <>Add another file — drop here, or <span className="underline">browse</span></>}
        </p>
        <p className="text-xs text-sorena-navy/50">
          {t('visaDocsPickerAcceptedTypes')}
        </p>
      </div>

      {topError && (
        <p className="mt-2 text-xs text-red-600">{topError}</p>
      )}

      {/* Inline confirm-delete overlay. Click-outside-to-cancel via the
          backdrop, Cancel button, or Esc-friendly button row. */}
      {confirmDelete && (
        <ConfirmDeleteOverlay
          fileName={confirmDelete.originalFilename}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={onConfirmDelete}
        />
      )}
    </div>
  );
}

// Project-convention inline overlay — backdrop + centered card. NOT
// a shadcn Dialog (the project deliberately rolls its own to keep the
// modal stack predictable on mobile).
export function ConfirmDeleteOverlay({
  fileName,
  onCancel,
  onConfirm,
}: {
  fileName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-sorena-navy/40 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-sorena-navy/10 bg-white p-5 shadow-xl"
      >
        <h3 className="mb-2 text-base font-bold text-sorena-navy">
          Delete file?
        </h3>
        <p className="mb-4 text-sm text-sorena-navy/70">
          Delete <span className="font-medium text-sorena-navy">{fileName}</span>?
          This can&rsquo;t be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-12 rounded-lg border border-sorena-navy/20 bg-white px-4 text-sm font-semibold text-sorena-navy transition-colors hover:bg-sorena-navy/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-12 rounded-lg border border-red-600 bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
