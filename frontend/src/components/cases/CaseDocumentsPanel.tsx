'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDate as fmtDate } from '@/lib/date';
import { useTranslations } from 'next-intl';
import { ExternalLink, FileText, Loader2, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// Shared Case Documents panel — used by the staff case-detail page AND
// the client portal /portal/case/documents page. Both surfaces use the
// SAME backend endpoints under /cases/:caseId/documents.
//
// Talks to the R2-backed flow (Documents steps 1-3): request-upload →
// raw PUT to the R2 presigned URL → confirm. View → presigned GET in a
// new tab. Delete → backend cascades to R2 then row, gated server-side.
//
// `canDelete` controls whether the Remove button + confirmation dialog
// render. Staff pass true; clients pass false (the backend ALSO refuses
// client deletes via the access helper, but hiding the button avoids
// surfacing a useless 403).
//
// Note on the R2 PUT: it must NOT go through the `api` helper, which
// injects our JWT + Content-Type: application/json. Cloudflare expects
// raw bytes + the file's own mimeType only.

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MiB — matches backend DTO

interface DocumentRow {
  id:           string;
  originalName: string;
  mimeType:     string;
  sizeBytes:    number;
  category:     string | null;
  status:       string;
  createdAt:    string;
  uploaderId:   string;
  uploaderName: string | null;
}

interface RequestUploadResponse {
  documentId:       string;
  uploadUrl:        string;
  r2Key:            string;
  expiresInSeconds: number;
}

interface DownloadUrlResponse {
  url:              string;
  expiresInSeconds: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  // Day-first NZ style ("8 Jul 2026") via the shared helper.
  return fmtDate(iso);
}

export function CaseDocumentsPanel({
  caseId,
  canDelete,
}: {
  caseId:    string;
  canDelete: boolean;
}) {
  const t = useTranslations();
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ name: string } | null>(null);
  const [deleting, setDeleting] = useState<DocumentRow | null>(null);
  const [deletingActive, setDeletingActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    api
      .get<DocumentRow[]>(`/cases/${caseId}/documents`)
      .then((rows) => setDocs(rows))
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : t('staff.cases.detail.documents.loadFailed'),
        ),
      );
  }, [caseId, t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handlePick = () => {
    fileInputRef.current?.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      toast.error(t('staff.cases.detail.documents.invalidType'));
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error(t('staff.cases.detail.documents.tooLarge'));
      return;
    }

    setUploading({ name: file.name });
    try {
      // 1. Ask the backend for a presigned PUT URL.
      const req = await api.post<RequestUploadResponse>(
        `/cases/${caseId}/documents/request-upload`,
        {
          originalName: file.name,
          mimeType:     file.type,
          sizeBytes:    file.size,
        },
      );

      // 2. PUT bytes directly to R2 — RAW fetch. No JWT, no api wrapper.
      //    Content-Type MUST match the signed mimeType or Cloudflare
      //    rejects the upload with SignatureDoesNotMatch.
      const putRes = await fetch(req.uploadUrl, {
        method:  'PUT',
        body:    file,
        headers: { 'Content-Type': file.type },
      });
      if (!putRes.ok) {
        throw new Error(`Upload to storage failed (HTTP ${putRes.status}).`);
      }

      // 3. Confirm — flips the row PENDING → UPLOADED and writes the
      //    audit entry. The empty body matches the backend signature.
      await api.post(`/cases/${caseId}/documents/${req.documentId}/confirm`, {});

      toast.success(t('staff.cases.detail.documents.uploaded'));
      refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('staff.cases.detail.documents.uploadFailed'),
      );
    } finally {
      setUploading(null);
    }
  };

  const handleView = async (doc: DocumentRow) => {
    try {
      const { url } = await api.get<DownloadUrlResponse>(
        `/cases/${caseId}/documents/${doc.id}/download-url`,
      );
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('staff.cases.detail.documents.viewFailed'),
      );
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeletingActive(true);
    try {
      await api.delete(`/cases/${caseId}/documents/${deleting.id}`);
      toast.success(t('staff.cases.detail.documents.deleted'));
      setDeleting(null);
      refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('staff.cases.detail.documents.deleteFailed'),
      );
    } finally {
      setDeletingActive(false);
    }
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
            {t('staff.cases.detail.documents.heading')}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {t('staff.cases.detail.documents.subheading')}
          </p>
        </div>
        <button
          type="button"
          onClick={handlePick}
          disabled={!!uploading}
          className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold hover:bg-[#162d4a] disabled:opacity-60 disabled:cursor-not-allowed transition-colors min-h-[48px]"
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {uploading
            ? t('staff.cases.detail.documents.uploading', { name: uploading.name })
            : t('staff.cases.detail.documents.uploadButton')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleFile}
          className="hidden"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 mb-4">
          {error}
        </div>
      )}

      {docs === null && !error && (
        <div className="py-12 text-center text-sm text-gray-500">
          {t('staff.cases.detail.documents.loading')}
        </div>
      )}

      {docs !== null && docs.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-[#faf8f3] p-8 text-center">
          <FileText size={28} className="mx-auto text-[#b8941f] mb-2" />
          <p className="text-sm text-gray-500">
            {t('staff.cases.detail.documents.empty')}
          </p>
        </div>
      )}

      {docs !== null && docs.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {docs.map((d) => (
            <li
              key={d.id}
              className="py-3 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <FileText size={20} className="text-[#1e3a5f] mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {d.originalName}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {formatSize(d.sizeBytes)} · {d.uploaderName ?? '—'} · {formatDate(d.createdAt)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => handleView(d)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-[#1e3a5f] border border-[#1e3a5f]/30 hover:bg-[#1e3a5f]/5 transition-colors min-h-[36px]"
                >
                  <ExternalLink size={14} />
                  {t('staff.cases.detail.documents.view')}
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => setDeleting(d)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-rose-700 border border-rose-200 hover:bg-rose-50 transition-colors min-h-[36px]"
                  >
                    <Trash2 size={14} />
                    {t('staff.cases.detail.documents.delete')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Delete confirmation overlay */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !deletingActive && setDeleting(null)}
          />
          <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-xl p-6">
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-lg font-bold text-[#1e3a5f]">
                {t('staff.cases.detail.documents.deleteTitle')}
              </h3>
              <button
                onClick={() => setDeleting(null)}
                disabled={deletingActive}
                className="text-gray-400 hover:text-gray-700 disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              {t('staff.cases.detail.documents.deleteBody', { name: deleting.originalName })}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleting(null)}
                disabled={deletingActive}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {t('staff.cases.detail.documents.deleteCancel')}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deletingActive}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-60"
              >
                {deletingActive && <Loader2 size={14} className="animate-spin" />}
                {t('staff.cases.detail.documents.deleteConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
