'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2, Upload, Download, Loader2, AlertCircle, X, Lock } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ConfirmDeleteOverlay, type VisaDocumentFile } from './DocumentMetadataPicker';

// PR-FILES-2 — Step-14 other-evidence: each entry now holds a list
// of files. The entry can be created with only the classification
// (evidenceType + optional customLabel); files attach via the
// per-file POST. Once ≥1 file exists the classification locks —
// the only way to "edit" type/label after that is to delete the
// whole entry and recreate.

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
  files: VisaDocumentFile[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
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

interface ServerPayload {
  otherEvidence: OtherEvidenceEntry[];
  [key: string]: unknown;
}

interface PendingUpload {
  localId: string;
  name: string;
  status: 'uploading' | 'error';
  error?: string;
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
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<VisaDocumentFile | null>(null);
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  const files = entry.files ?? [];
  const visibleFiles = files.filter((f) => !deletingIds.has(f.id));
  const locked = files.length > 0; // PR-FILES-2 lock-after-upload rule

  const removePending = (localId: string) =>
    setPending((p) => p.filter((x) => x.localId !== localId));
  const setPendingStatus = (localId: string, patch: Partial<PendingUpload>) =>
    setPending((p) => p.map((x) => (x.localId === localId ? { ...x, ...patch } : x)));

  // Persist type/customLabel — only ever called while unlocked.
  const persistClassification = async (overrides?: Partial<{ evidenceType: OtherEvidenceType; customLabel: string }>) => {
    setTopError(null);
    const nextType = overrides?.evidenceType ?? evidenceType;
    const nextLabel = overrides?.customLabel ?? customLabel;
    if (nextType === 'OTHER' && nextLabel.trim() === '') {
      setTopError(t('visaDocs2ValidationCustomLabelRequired'));
      return;
    }
    try {
      const next = await api.put<ServerPayload>(
        '/students/me/visa/supporting-documents-2/other-evidence',
        {
          id: entry.id,
          evidenceType: nextType,
          customLabel: nextType === 'OTHER' ? nextLabel.trim() : null,
        },
      );
      onServerChange(next);
    } catch (caught) {
      setTopError(caught instanceof Error ? caught.message : '');
    }
  };

  const uploadMany = (chosen: File[]) => {
    setTopError(null);
    if (chosen.length === 0) return;
    // Guard: when OTHER and customLabel is empty we can't attach
    // files yet (server would 400) — surface a friendly message
    // and don't queue anything.
    if (evidenceType === 'OTHER' && customLabel.trim() === '') {
      setTopError(t('visaDocs2ValidationCustomLabelRequired'));
      return;
    }
    const accepted: Array<{ localId: string; file: File }> = [];
    const rejected: PendingUpload[] = [];
    for (const f of chosen) {
      const v = validateFile(f, t);
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (v) {
        rejected.push({ localId, name: f.name, status: 'error', error: v });
      } else {
        accepted.push({ localId, file: f });
      }
    }
    if (rejected.length > 0) setPending((p) => [...p, ...rejected]);
    if (accepted.length === 0) return;
    setPending((p) => [
      ...p,
      ...accepted.map(({ localId, file }) => ({
        localId,
        name: file.name,
        status: 'uploading' as const,
      })),
    ]);
    for (const { localId, file } of accepted) {
      void (async () => {
        try {
          const fd = new FormData();
          fd.append('file', file);
          const next = await api.upload<ServerPayload>(
            `/students/me/visa/supporting-documents-2/other-evidence/${entry.id}/file`,
            fd,
          );
          onServerChange(next);
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
        `/students/me/visa/supporting-documents-2/other-evidence/files/${file.id}/download`,
      );
      const absolute = url.startsWith('http') ? url : `${API_URL}${url}`;
      window.open(absolute, '_blank', 'noopener');
    } catch (caught) {
      setTopError(caught instanceof ApiError ? caught.message : 'Failed to open file.');
    }
  };

  const onConfirmDeleteFile = async () => {
    if (!confirmDeleteFile) return;
    const file = confirmDeleteFile;
    setConfirmDeleteFile(null);
    setDeletingIds((s) => new Set(s).add(file.id));
    try {
      const next = await api.delete<ServerPayload>(
        `/students/me/visa/supporting-documents-2/other-evidence/files/${file.id}`,
      );
      onServerChange(next);
      setDeletingIds((s) => {
        const n = new Set(s);
        n.delete(file.id);
        return n;
      });
    } catch (caught) {
      setDeletingIds((s) => {
        const n = new Set(s);
        n.delete(file.id);
        return n;
      });
      setTopError(caught instanceof ApiError ? caught.message : 'Failed to delete file.');
    }
  };

  const onConfirmDeleteEntry = async () => {
    setConfirmDeleteEntry(false);
    setTopError(null);
    try {
      const next = await api.delete<ServerPayload>(
        `/students/me/visa/supporting-documents-2/other-evidence/${entry.id}`,
      );
      onServerChange(next);
    } catch (caught) {
      setTopError(caught instanceof Error ? caught.message : 'Failed to delete entry.');
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

  const typeLabel = t(`visaDocs2EvidenceType_${entry.evidenceType}` as Parameters<typeof t>[0]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-sorena-navy/10 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
          {typeLabel}
        </h4>
        <button
          type="button"
          onClick={() => setConfirmDeleteEntry(true)}
          title={t('visaDocs2OtherEvidenceRemove')}
          aria-label={t('visaDocs2OtherEvidenceRemove')}
          className="flex h-10 min-w-10 items-center justify-center rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Classification — editable until first file is uploaded. */}
      {locked ? (
        <div className="flex flex-col gap-1 rounded-lg bg-sorena-navy/[0.03] px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-sorena-navy/50">
            {t('visaDocs2EvidenceTypeLabel')}
          </span>
          <span className="text-sm text-sorena-navy">
            {typeLabel}
            {entry.customLabel && (
              <span className="text-sorena-navy/60"> · {entry.customLabel}</span>
            )}
          </span>
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-sorena-navy/50">
            <Lock size={11} /> Locked once files are attached. Delete the entry to change.
          </span>
        </div>
      ) : (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaDocs2EvidenceTypeLabel')}
            </label>
            <select
              value={evidenceType}
              onChange={(e) => {
                const v = e.target.value as OtherEvidenceType;
                setEvidenceType(v);
                void persistClassification({ evidenceType: v });
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
                onBlur={() => {
                  if (customLabel.trim() !== '' && customLabel !== (entry.customLabel ?? '')) {
                    void persistClassification();
                  }
                }}
                className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
              />
            </div>
          )}
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        multiple
        onChange={onPicked}
        className="hidden"
      />

      {/* File list — persisted + pending. */}
      {(visibleFiles.length > 0 || pending.length > 0) && (
        <ul className="flex flex-col gap-2">
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
                onClick={() => setConfirmDeleteFile(f)}
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
                <p className="truncate text-sm font-medium text-sorena-navy">{p.name}</p>
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

      {/* Always-visible drop zone. */}
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

      {topError && <p className="text-xs text-red-600">{topError}</p>}

      {confirmDeleteFile && (
        <ConfirmDeleteOverlay
          fileName={confirmDeleteFile.originalFilename}
          onCancel={() => setConfirmDeleteFile(null)}
          onConfirm={onConfirmDeleteFile}
        />
      )}
      {confirmDeleteEntry && (
        <ConfirmDeleteOverlay
          fileName={`${typeLabel}${entry.customLabel ? ` (${entry.customLabel})` : ''} and all its files`}
          onCancel={() => setConfirmDeleteEntry(false)}
          onConfirm={onConfirmDeleteEntry}
        />
      )}
    </div>
  );
}

// "Add another" form — creates a classification-only entry. Files
// attach later via the card above. No file input here — the entry
// has to exist before files can be POSTed to its id.
interface AdderProps {
  onServerChange: (next: ServerPayload) => void;
}

export function OtherEvidenceAdder({ onServerChange }: AdderProps) {
  const t = useTranslations();
  const [evidenceType, setEvidenceType] = useState<OtherEvidenceType>('COVER_LETTER');
  const [customLabel, setCustomLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onAdd = async () => {
    setError(null);
    if (evidenceType === 'OTHER' && customLabel.trim() === '') {
      setError(t('visaDocs2ValidationCustomLabelRequired'));
      return;
    }
    setBusy(true);
    try {
      const next = await api.put<ServerPayload>(
        '/students/me/visa/supporting-documents-2/other-evidence',
        {
          evidenceType,
          customLabel: evidenceType === 'OTHER' ? customLabel.trim() : null,
        },
      );
      onServerChange(next);
      setCustomLabel('');
      setEvidenceType('COVER_LETTER');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '');
    } finally {
      setBusy(false);
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
      <button
        type="button"
        onClick={onAdd}
        disabled={busy}
        className="h-12 self-start rounded-lg border border-sorena-navy bg-sorena-navy px-4 text-sm font-semibold text-white transition-colors hover:bg-sorena-navy/90 disabled:opacity-40"
      >
        {busy ? 'Adding…' : 'Add entry'}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
