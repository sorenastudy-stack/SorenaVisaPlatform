'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Upload, FileText, Eye, Download, Trash2 } from 'lucide-react';
import { useAdmission } from './AdmissionFormContext';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { useDocumentReviewStatuses } from '@/components/documents/useDocumentReviewStatuses';
import { DocumentReviewBadge } from '@/components/documents/DocumentReviewBadge';

const ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_BYTES = 10 * 1024 * 1024;
const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

export function DocumentUploader({
  documentType,
  label,
  helperText,
  single = false,
  required = false,
  educationEntryId,
}: {
  documentType: string;
  label: string;
  helperText?: string;
  single?: boolean;
  required?: boolean;
  /**
   * Optional. When provided, this uploader is scoped to a specific
   * AdmissionEducationEntry: uploads attach with educationEntryId set,
   * and the document list filters to docs for that entry only.
   * When absent (default), behaves as today (application-level docs).
   */
  educationEntryId?: string;
}) {
  const t = useTranslations();
  const { documents, uploadDocument, deleteDocument } = useAdmission();
  const { statusFor } = useDocumentReviewStatuses();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter by documentType plus the scoping rule:
  //   - educationEntryId set → only docs for that entry
  //   - educationEntryId absent → only app-level docs (no entry link)
  const typeDocs = documents.filter(d => {
    if (d.documentType !== documentType) return false;
    if (educationEntryId !== undefined) {
      return d.educationEntryId === educationEntryId;
    }
    return d.educationEntryId === null;
  });
  const showUpload = !single || typeDocs.length === 0;

  const handleFile = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error(t('admissionUploadSizeError'));
      return;
    }
    if (!ALLOWED_MIMES.includes(file.type)) {
      toast.error(t('admissionUploadTypeError'));
      return;
    }
    setUploading(true);
    try {
      await uploadDocument(documentType, file, educationEntryId);
    } catch {
      toast.error(t('admissionUploadFailed'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const openSignedUrl = async (docId: string, download: boolean, fileName: string) => {
    try {
      const { url } = await api.get<{ url: string; expiresInSeconds: number }>(
        `/students/me/admission/documents/${docId}/download`,
      );
      const full = `${BACKEND}${url}`;
      if (download) {
        const a = document.createElement('a');
        a.href = full;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        window.open(full, '_blank', 'noopener,noreferrer');
      }
    } catch {
      toast.error(t('admissionUploadFailed'));
    }
  };

  const handleDelete = async (docId: string) => {
    if (!window.confirm(t('admissionUploadRemoveConfirm'))) return;
    try {
      await deleteDocument(docId);
    } catch {
      toast.error(t('admissionUploadDeleteFailed'));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>

      {helperText && (
        <p className="text-sm text-sorena-navy/50">{helperText}</p>
      )}

      {typeDocs.map(doc => (
        <div
          key={doc.id}
          className="flex items-center gap-3 rounded-xl border border-sorena-navy/10 bg-white p-3"
        >
          <FileText size={16} className="shrink-0 text-sorena-navy/40" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-sorena-navy">{doc.fileName}</p>
            <p className="text-xs text-sorena-navy/40">
              {fmtBytes(doc.fileSizeBytes)} · {formatDate(doc.uploadedAt)}
            </p>
            {(() => {
              const review = statusFor('ADMISSION', doc.id);
              return review ? (
                <div className="mt-1.5">
                  <DocumentReviewBadge status={review.status} reason={review.reason} />
                </div>
              ) : null;
            })()}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => openSignedUrl(doc.id, false, doc.fileName)}
              title={t('admissionUploadView')}
              className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-sorena-navy/5 hover:text-sorena-navy"
            >
              <Eye size={15} />
            </button>
            <button
              onClick={() => openSignedUrl(doc.id, true, doc.fileName)}
              title={t('admissionUploadDownload')}
              className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-sorena-navy/5 hover:text-sorena-navy"
            >
              <Download size={15} />
            </button>
            <button
              onClick={() => handleDelete(doc.id)}
              title={t('admissionUploadRemove')}
              className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      ))}

      {showUpload && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !uploading && inputRef.current?.click()}
          className={[
            'flex cursor-pointer select-none flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 transition-colors',
            dragOver
              ? 'border-sorena-navy/50 bg-sorena-navy/5'
              : 'border-sorena-navy/20 hover:border-sorena-navy/30 hover:bg-sorena-navy/[0.02]',
            uploading ? 'pointer-events-none opacity-60' : '',
          ].join(' ')}
        >
          <Upload size={20} className="text-sorena-navy/40" />
          <p className="text-center text-sm text-sorena-navy/60">
            {uploading ? 'Uploading…' : t('admissionUploadDropzone')}
          </p>
          <p className="text-xs text-sorena-navy/40">
            {t('admissionUploadAllowedTypes')} · {t('admissionUploadMaxSize')}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </div>
      )}
    </div>
  );
}
