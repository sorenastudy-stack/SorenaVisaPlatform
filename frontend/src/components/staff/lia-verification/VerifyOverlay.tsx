'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { X, ShieldCheck, Download, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import type { PendingProfileRow } from './LiaVerificationPageClient';

// PR-DOCUSIGN-1 step 3 (Screen B) — verifier detail overlay.
//
// Two stages live inside one modal:
//   'detail'    — read-only fields + Download + Verify + Reject… buttons
//   'rejecting' — reason textarea (react-hook-form + zod, 10–1000 chars)
//                 + Reject licence + Back + Cancel
//
// E6 (download) is audited on the backend. E7 (verify) and E8 (reject)
// are self-guarded server-side — an OWNER/ADMIN who is ALSO the target
// LIA gets a 403 with "You cannot verify your own LIA profile" — the
// toast surfaces that message verbatim from the backend.

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

const rejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Reason must be at least 10 characters.')
    .max(1000, 'Reason must be at most 1000 characters.'),
});
type RejectFormValues = z.infer<typeof rejectSchema>;

type Stage = 'detail' | 'rejecting';

export function VerifyOverlay({
  row,
  onClose,
  onDone,
}: {
  row: PendingProfileRow;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [stage, setStage] = useState<Stage>('detail');
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const onDownload = async () => {
    setDownloading(true);
    try {
      const data = await api.get<{ url: string; expiresInSeconds: number }>(
        `/staff/lia-profiles/${row.userId}/licence-file/download-url`,
      );
      window.open(`${API_URL}${data.url}`, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to fetch download URL.');
    } finally {
      setDownloading(false);
    }
  };

  const onVerify = async () => {
    setSubmitting(true);
    try {
      await api.post(`/staff/lia-profiles/${row.userId}/verify`, {});
      toast.success(`${row.userName}'s licence verified.`);
      await onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to verify.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => (submitting ? null : onClose())}
      />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-full bg-sorena-gold/20 flex items-center justify-center flex-shrink-0">
              <ShieldCheck size={18} className="text-sorena-navy" />
            </div>
            <h2 className="text-lg font-bold text-sorena-navy">
              {stage === 'detail' ? 'Verify LIA licence' : 'Reject licence'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {stage === 'detail' ? (
          <DetailView
            row={row}
            downloading={downloading}
            submitting={submitting}
            onDownload={onDownload}
            onVerify={onVerify}
            onStartReject={() => setStage('rejecting')}
            onCancel={onClose}
          />
        ) : (
          <RejectForm
            row={row}
            onSubmittingChange={setSubmitting}
            onBack={() => setStage('detail')}
            onSuccess={onDone}
            onCancel={onClose}
          />
        )}
      </div>
    </div>
  );
}

// ─── Stage: detail ───────────────────────────────────────────────────────

function DetailView({
  row,
  downloading,
  submitting,
  onDownload,
  onVerify,
  onStartReject,
  onCancel,
}: {
  row: PendingProfileRow;
  downloading: boolean;
  submitting: boolean;
  onDownload: () => void;
  onVerify: () => void;
  onStartReject: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <dl className="space-y-2 text-sm mb-4">
        <Field label="LIA">
          <div className="font-semibold text-sorena-navy">{row.userName}</div>
          <div className="text-xs text-[#4A4A4A]/60">{row.userEmail}</div>
        </Field>
        <Field label="Licence #">
          <span className="font-mono">{row.iaaLicenceNumber}</span>
        </Field>
        <Field label="File">
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading || submitting}
            title="Open the licence in a new tab"
            className="flex items-center gap-1.5 text-left text-[#1e3a5f] underline decoration-dotted underline-offset-2 hover:text-[#c9a961] disabled:opacity-60"
          >
            <FileText size={14} className="text-[#4A4A4A]/60" />
            <span className="truncate">{row.iaaLicenceFileName}</span>
          </button>
          <div className="text-xs text-[#4A4A4A]/60 mt-0.5">
            {formatBytes(row.iaaLicenceSizeBytes)} · {row.iaaLicenceFileMime}
          </div>
        </Field>
        <Field label="Uploaded">
          <span className="text-[#4A4A4A]">{formatRelative(row.uploadedAt)}</span>
        </Field>
        <Field label="Prior rejections">
          {row.priorRejections > 0 ? (
            <span className="text-amber-800 font-semibold">{row.priorRejections}</span>
          ) : (
            <span className="text-[#4A4A4A]/60">None</span>
          )}
        </Field>
      </dl>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onDownload}
        disabled={downloading || submitting}
        className="w-full mb-2"
      >
        <Download size={14} className="mr-2" />
        {downloading ? 'Opening…' : 'Download licence to review'}
      </Button>

      <p className="text-xs text-[#4A4A4A]/60 mb-5">
        Opens in a new tab. This download is recorded in the audit log.
      </p>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={submitting}
          onClick={onVerify}
          className="flex-1"
        >
          {submitting ? '…' : 'Verify'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="md"
          disabled={submitting}
          onClick={onStartReject}
          className="flex-1"
        >
          Reject…
        </Button>
        <Button type="button" variant="ghost" size="md" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}

// ─── Stage: rejecting ────────────────────────────────────────────────────

function RejectForm({
  row,
  onSubmittingChange,
  onBack,
  onSuccess,
  onCancel,
}: {
  row: PendingProfileRow;
  onSubmittingChange: (b: boolean) => void;
  onBack: () => void;
  onSuccess: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RejectFormValues>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: '' },
  });

  const onSubmit = async (values: RejectFormValues) => {
    onSubmittingChange(true);
    try {
      await api.post(`/staff/lia-profiles/${row.userId}/reject`, {
        reason: values.reason.trim(),
      });
      toast.success(`${row.userName}'s licence rejected.`);
      await onSuccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to reject.');
    } finally {
      onSubmittingChange(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <p className="text-sm text-[#4A4A4A] mb-3">
        <strong>{row.userName}</strong> · Licence #{' '}
        <span className="font-mono">{row.iaaLicenceNumber}</span>
      </p>
      <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">
        Why are you rejecting this licence?
      </label>
      <textarea
        rows={5}
        maxLength={1000}
        placeholder="Be specific — the LIA will see this reason on their profile."
        disabled={isSubmitting}
        {...register('reason')}
        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sorena-navy/30 resize-none disabled:bg-gray-50"
      />
      {errors.reason && (
        <p className="mt-1 text-xs text-rose-600">{errors.reason.message}</p>
      )}
      <p className="mt-2 text-xs text-[#4A4A4A]/60">
        10–1000 characters. The reason is recorded in the audit log and shown to the LIA.
      </p>

      <div className="mt-5 flex items-center gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 min-h-[48px] px-4 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:bg-rose-200 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Rejecting…' : 'Reject licence'}
        </button>
        <Button type="button" variant="ghost" size="md" disabled={isSubmitting} onClick={onBack}>
          Back
        </Button>
        <Button type="button" variant="ghost" size="md" disabled={isSubmitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Shared ──────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3">
      <dt className="text-xs font-semibold text-[#4A4A4A]/70 pt-0.5">{label}</dt>
      <dd className="text-sm min-w-0">{children}</dd>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}
