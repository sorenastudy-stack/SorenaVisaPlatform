'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FileText, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/date';

// PR-VISA2 fix — INZ visa photo uploader.
// Reuses the admission-documents pipeline (same endpoints, same signed-URL
// pattern), keyed on documentType="VISA_PHOTO". This component owns its
// own state — it does NOT use the admission context, since the visa shell
// runs under VisaProvider, not AdmissionProvider.
//
// INZ rules enforced client-side at upload time (also re-enforced by the
// existing admission upload endpoint's MIME/size limits as a defence in
// depth):
//   - Extension/MIME: .jpeg or .jpg only.
//   - Size: between PHOTO_MIN_BYTES and PHOTO_MAX_BYTES.
//   - Dimensions: width in [PHOTO_MIN_W, PHOTO_MAX_W], height in
//     [PHOTO_MIN_H, PHOTO_MAX_H].
// We do not attempt server-side dimension validation in this PR — that
// would require a new image dependency (sharp / image-size). The client
// check is sufficient for honest users; an attacker can only hurt their
// own application by bypassing it.

const PHOTO_MIN_BYTES = 500 * 1024;          // 500 KB
const PHOTO_MAX_BYTES = 3 * 1024 * 1024;     // 3 MB
const PHOTO_MIN_W = 900;
const PHOTO_MAX_W = 2250;
const PHOTO_MIN_H = 1200;
const PHOTO_MAX_H = 3000;

interface PhotoDoc {
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

// Resolve a File's intrinsic pixel dimensions via Image API. Used only for
// client-side INZ validation; the file is sent unmodified to the server.
function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dims);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

export function VisaPhotoUploader({
  hasError,
  onPhotoChange,
}: {
  hasError?: boolean;
  // Fires whenever the photo state changes (after fetch on mount, after
  // upload, after delete). Parent uses this to gate Save and continue on
  // photo presence.
  onPhotoChange: (hasPhoto: boolean) => void;
}) {
  const t = useTranslations();
  const [photos, setPhotos] = useState<PhotoDoc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initial fetch — INZ requires a photo to complete this step, so we must
  // know whether the student has already uploaded one when Step 1 mounts.
  useEffect(() => {
    let cancelled = false;
    api
      .get<PhotoDoc[]>('/students/me/admission/documents?documentType=VISA_PHOTO')
      .then((docs) => {
        if (cancelled) return;
        const list = Array.isArray(docs) ? docs : [];
        setPhotos(list);
        onPhotoChange(list.length > 0);
      })
      .catch(() => { /* leave photos empty; parent's gate will keep blocking */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validate = async (file: File): Promise<string | null> => {
    // Accept image/jpeg (covers .jpg and .jpeg); reject everything else.
    if (file.type !== 'image/jpeg') return t('visaPhotoErrorType');
    if (file.size < PHOTO_MIN_BYTES || file.size > PHOTO_MAX_BYTES) {
      return t('visaPhotoErrorSize');
    }
    let dims: { width: number; height: number };
    try {
      dims = await readImageDimensions(file);
    } catch {
      return t('visaPhotoErrorUnreadable');
    }
    if (
      dims.width  < PHOTO_MIN_W || dims.width  > PHOTO_MAX_W ||
      dims.height < PHOTO_MIN_H || dims.height > PHOTO_MAX_H
    ) {
      return t('visaPhotoErrorDimensions');
    }
    return null;
  };

  const handleFile = async (file: File) => {
    const err = await validate(file);
    if (err) {
      toast.error(err);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('documentType', 'VISA_PHOTO');
      const doc = await api.upload<PhotoDoc>('/students/me/admission/documents', form);
      const next = [...photos, doc];
      setPhotos(next);
      onPhotoChange(next.length > 0);
      toast.success(t('visaPhotoUploadSuccess'));
    } catch {
      toast.error(t('visaPhotoUploadError'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDelete = async (docId: string) => {
    if (!window.confirm(t('visaPhotoDeleteConfirm'))) return;
    try {
      await api.delete<void>(`/students/me/admission/documents/${docId}`);
      const next = photos.filter((d) => d.id !== docId);
      setPhotos(next);
      onPhotoChange(next.length > 0);
    } catch {
      toast.error(t('visaPhotoDeleteError'));
    }
  };

  // INZ collects exactly one photo per application. We hide the upload zone
  // once a photo exists; deleting it shows the zone again.
  const hasPhoto = photos.length > 0;

  return (
    <div className="flex flex-col gap-2">
      {photos.map((doc) => (
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
          </div>
          <button
            onClick={() => handleDelete(doc.id)}
            title={t('visaPhotoDeleteTooltip')}
            className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}

      {!hasPhoto && (
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
              ? t('visaPhotoUploading')
              : loaded
                ? t('visaPhotoDropzone')
                : t('visaPhotoLoading')}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,image/jpeg"
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
