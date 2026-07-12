'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FileText, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { useDocumentReviewStatuses } from '@/components/documents/useDocumentReviewStatuses';
import { DocumentReviewBadge } from '@/components/documents/DocumentReviewBadge';

// Generic Visa Section document uploader. Reuses the admission documents
// pipeline (same endpoints, same signed-URL pattern), keyed on the
// documentType prop. Sibling to VisaPhotoUploader; that one stays
// specialist because it carries the INZ photo-specific dimension/size
// rules. This component handles every other visa document type with a
// simple MIME + size check.
//
// Like VisaPhotoUploader, this component owns its own state — it does
// NOT use the admission context (visa renders under VisaProvider). It
// reports presence via onChange so the parent step can gate its Save.

const DEFAULT_ALLOWED_MIMES = ['application/pdf', 'image/jpeg', 'image/png'];
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches admission's

interface DocRow {
  id: string;
  documentType: string;
  fileName: string;
  fileSizeBytes: number;
  uploadedAt: string;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

export function VisaDocumentUploader({
  documentType,
  hasError,
  onChange,
  allowedMimes = DEFAULT_ALLOWED_MIMES,
  maxBytes = DEFAULT_MAX_BYTES,
  accept = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png',
  // Single-file UX: hide the dropzone once a doc is uploaded; deleting it
  // shows the zone again. Police certificates from the country of
  // citizenship are single; the 5+ years branch allows multiple, so
  // callers in that branch can pass single={false}.
  single = true,
}: {
  documentType: string;
  hasError?: boolean;
  onChange: (count: number) => void;
  allowedMimes?: string[];
  maxBytes?: number;
  accept?: string;
  single?: boolean;
}) {
  const t = useTranslations();
  const { statusFor } = useDocumentReviewStatuses();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initial fetch for existing docs of this type — the parent step's Save
  // gate relies on the count reported back through onChange.
  useEffect(() => {
    let cancelled = false;
    api
      .get<DocRow[]>(`/students/me/admission/documents?documentType=${encodeURIComponent(documentType)}`)
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : [];
        setDocs(list);
        onChange(list.length);
      })
      .catch(() => { /* leave docs empty; parent gate stays blocked */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentType]);

  const handleFile = async (file: File) => {
    if (file.size > maxBytes) {
      toast.error(t('visaDocumentErrorSize'));
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    if (!allowedMimes.includes(file.type)) {
      toast.error(t('visaDocumentErrorType'));
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('documentType', documentType);
      const doc = await api.upload<DocRow>('/students/me/admission/documents', form);
      const next = [...docs, doc];
      setDocs(next);
      onChange(next.length);
      toast.success(t('visaDocumentUploadSuccess'));
    } catch {
      toast.error(t('visaDocumentUploadError'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDelete = async (docId: string) => {
    if (!window.confirm(t('visaDocumentDeleteConfirm'))) return;
    try {
      await api.delete<void>(`/students/me/admission/documents/${docId}`);
      const next = docs.filter((d) => d.id !== docId);
      setDocs(next);
      onChange(next.length);
    } catch {
      toast.error(t('visaDocumentDeleteError'));
    }
  };

  const showZone = !single || docs.length === 0;

  return (
    <div className="flex flex-col gap-2">
      {docs.map((doc) => (
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
          <button
            onClick={() => handleDelete(doc.id)}
            title={t('visaDocumentDeleteTooltip')}
            className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}

      {showZone && (
        <div
          onClick={() => !uploading && inputRef.current?.click()}
          className={[
            'flex cursor-pointer select-none flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 transition-colors',
            hasError
              ? 'border-red-400 bg-red-50/60'
              : 'border-sorena-navy/20 hover:border-sorena-navy/30 hover:bg-sorena-navy/[0.02]',
            uploading ? 'pointer-events-none opacity-60' : '',
          ].join(' ')}
        >
          <Upload size={20} className="text-sorena-navy/40" />
          <p className="text-center text-sm text-sorena-navy/60">
            {uploading
              ? t('visaDocumentUploading')
              : loaded
                ? t('visaDocumentDropzone')
                : t('visaDocumentLoading')}
          </p>
          <p className="text-xs text-sorena-navy/40">
            {t('visaDocumentAllowedTypes')} · {t('visaDocumentMaxSize', { mb: Math.round(maxBytes / 1_048_576) })}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </div>
      )}
    </div>
  );
}
