'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDate as fmtDate } from '@/lib/date';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  CheckCircle2, XCircle, Hourglass, AlertCircle, Download, Upload,
  FileText,
  type LucideIcon,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { BackLink } from '@/components/ui/BackLink';

// PR-DOCUSIGN-1 step 3 (Screen A) — LIA "My Licence" client component.
//
// State + render breakdown:
//   1. Status banner — derived from E1's verificationState. Renders
//      a distinct colour + icon for each of:
//        VERIFIED, REJECTED, PENDING-awaiting-review, PENDING-incomplete
//      (the last is derived locally — incomplete means missing number
//      or file; backend reports PENDING for both incomplete and
//      complete-awaiting-review).
//   2. Licence number form — react-hook-form + zod matching the
//      backend DTO (/^[0-9]{6,12}$/). PUT to E2; show a yellow
//      "this will reset your verification" notice when the row is
//      already verified.
//   3. Licence file section — current file (with Download via E4) +
//      file picker + Upload button. Mirrors SubmitToInzButton's plain-
//      state validation pattern. POST to E3.
//
// After any mutation we re-fetch E1 to surface the new verification
// state / metadata. Errors surface via sonner toast (success too).

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

const MAX_LICENCE_BYTES = 10 * 1024 * 1024;
// PR-DOCUSIGN-1 (scope widening): IAA licence accepts PDF or an
// image (PNG / JPG). Must mirror the backend allowlist in
// lia-profiles.controller.ts / lia-profiles.service.ts.
const ALLOWED_LICENCE_MIMES = ['application/pdf', 'image/png', 'image/jpeg'] as const;

interface LiaProfileResponse {
  id: string;
  userId: string;
  iaaLicenceNumber:       string | null;
  iaaLicenceFileName:     string | null;
  iaaLicenceFileMime:     string | null;
  iaaLicenceSizeBytes:    number | null;
  iaaLicenceUploadedAt:   string | null;
  iaaLicenceVerifiedAt:   string | null;
  iaaLicenceVerifiedById: string | null;
  verificationState:      'PENDING' | 'VERIFIED' | 'REJECTED';
  lastRejectionReason:    string | null;
  lastRejectionAt:        string | null;
  createdAt: string;
  updatedAt: string;
}

const numberSchema = z.object({
  iaaLicenceNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,12}$/, 'Use 6–12 digits, numeric only.'),
});
type NumberFormValues = z.infer<typeof numberSchema>;

export function LicencePageClient() {
  const [profile, setProfile] = useState<LiaProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingNumber, setSavingNumber] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ─── Load + refresh ────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<LiaProfileResponse>('/staff/lia-profile/me');
      setProfile(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Failed to load your profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ─── Licence-number form ───────────────────────────────────────────

  const {
    register: registerNumber,
    handleSubmit: handleNumberSubmit,
    reset: resetNumberForm,
    formState: { errors: numberErrors, isDirty: numberDirty },
  } = useForm<NumberFormValues>({
    resolver: zodResolver(numberSchema),
    defaultValues: { iaaLicenceNumber: '' },
  });

  // Keep the form's initial value in sync with the loaded profile so
  // the "Save" button is only enabled when the field changes.
  useEffect(() => {
    if (profile) {
      resetNumberForm({ iaaLicenceNumber: profile.iaaLicenceNumber ?? '' });
    }
  }, [profile, resetNumberForm]);

  const onSubmitNumber = async (values: NumberFormValues) => {
    setSavingNumber(true);
    try {
      const result = await api.put<{ ok: boolean; changed: boolean; resetsVerification: boolean }>(
        '/staff/lia-profile/me/licence-number',
        { iaaLicenceNumber: values.iaaLicenceNumber },
      );
      if (result.changed) {
        toast.success(
          result.resetsVerification
            ? 'Licence number updated. Your previous verification was cleared — an OWNER will need to re-verify.'
            : 'Licence number saved.',
        );
      } else {
        toast.success('No changes — licence number was already saved.');
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save licence number.');
    } finally {
      setSavingNumber(false);
    }
  };

  // ─── File upload ───────────────────────────────────────────────────

  const fileIsValid =
    !!pickedFile
    && ALLOWED_LICENCE_MIMES.includes(pickedFile.type as (typeof ALLOWED_LICENCE_MIMES)[number])
    && pickedFile.size <= MAX_LICENCE_BYTES;

  const onUpload = async () => {
    if (!pickedFile || !fileIsValid) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', pickedFile);
      const result = await api.upload<{
        ok: boolean;
        fileName: string;
        sizeBytes: number;
        mime: string;
        replacedPrior: boolean;
        resetsVerification: boolean;
      }>('/staff/lia-profile/me/licence-file', fd);
      toast.success(
        result.resetsVerification
          ? 'Licence uploaded. Your previous verification was cleared — an OWNER will need to re-verify.'
          : result.replacedPrior
            ? 'Licence replaced.'
            : 'Licence uploaded.',
      );
      setPickedFile(null);
      // Clear the <input type="file"> so the same file can be re-selected later.
      const input = document.getElementById('licence-file-input') as HTMLInputElement | null;
      if (input) input.value = '';
      await refresh();
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Failed to upload licence.');
    } finally {
      setUploading(false);
    }
  };

  // ─── Download (own file) ───────────────────────────────────────────

  const onDownloadOwn = async () => {
    setDownloading(true);
    try {
      const data = await api.get<{ url: string; expiresInSeconds: number }>(
        '/staff/lia-profile/me/licence-file/download-url',
      );
      // The backend returns a path; prefix with the API base so the
      // browser opens it on the backend host.
      window.open(`${API_URL}${data.url}`, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to fetch download URL.');
    } finally {
      setDownloading(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl">
      <BackLink href="/lia" label="Back to dashboard" />

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-sorena-navy">My IAA Licence</h1>
        <p className="text-sm text-[#4A4A4A]/80 mt-1">
          Manage your Immigration Advisers Authority credentials. Until your licence is verified by an OWNER,
          you cannot be auto-assigned to new contracts.
        </p>
      </div>

      {loadError && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{loadError}</CardContent>
        </Card>
      )}

      {loading && !profile && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[#4A4A4A]/60">
            Loading your licence profile…
          </CardContent>
        </Card>
      )}

      {profile && (
        <div className="space-y-4">
          {/* Status banner */}
          <StatusBanner profile={profile} />

          {/* Licence number */}
          <Card>
            <CardContent>
              <h2 className="text-base font-bold text-sorena-navy mb-1">IAA licence number</h2>
              <p className="text-xs text-[#4A4A4A]/70 mb-3">6–12 digits, numeric only.</p>

              <form onSubmit={handleNumberSubmit(onSubmitNumber)} className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="e.g. 202412345"
                    disabled={savingNumber}
                    {...registerNumber('iaaLicenceNumber')}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sorena-navy/30 min-h-[48px] disabled:bg-gray-50"
                  />
                  {numberErrors.iaaLicenceNumber && (
                    <p className="mt-1 text-xs text-rose-600">{numberErrors.iaaLicenceNumber.message}</p>
                  )}
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  disabled={savingNumber || !numberDirty}
                  className="sm:w-32"
                >
                  {savingNumber ? 'Saving…' : 'Save'}
                </Button>
              </form>

              {profile.verificationState === 'VERIFIED' && (
                <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>
                    Changing your licence number will clear your verified status. An OWNER will need to re-verify it.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Licence file */}
          <Card>
            <CardContent>
              <h2 className="text-base font-bold text-sorena-navy mb-1">Licence certificate</h2>
              <p className="text-xs text-[#4A4A4A]/70 mb-3">PDF, PNG, or JPG. Max 10 MB.</p>

              {/* Current file row */}
              <div className="mb-4">
                <div className="text-xs font-semibold text-[#4A4A4A] mb-1">Currently on file</div>
                {profile.iaaLicenceFileName ? (
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-200 bg-sorena-cream">
                    <FileText size={18} className="text-sorena-navy flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-sorena-navy truncate">
                        {profile.iaaLicenceFileName}
                      </div>
                      <div className="text-xs text-[#4A4A4A]/60">
                        {formatBytes(profile.iaaLicenceSizeBytes)}
                        {profile.iaaLicenceUploadedAt && ` · uploaded ${formatRelative(profile.iaaLicenceUploadedAt)}`}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={onDownloadOwn}
                      disabled={downloading}
                    >
                      <Download size={14} className="mr-1" />
                      {downloading ? '…' : 'Download'}
                    </Button>
                  </div>
                ) : (
                  <div className="px-3 py-2.5 rounded-xl border border-dashed border-gray-300 bg-gray-50 text-sm text-[#4A4A4A]/70">
                    No licence file uploaded yet.
                  </div>
                )}
              </div>

              {/* New upload */}
              <div className="text-xs font-semibold text-[#4A4A4A] mb-1">
                Upload {profile.iaaLicenceFileName ? 'a new licence' : 'your licence'}
              </div>
              <input
                id="licence-file-input"
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(e) => {
                  setPickedFile(e.target.files?.[0] ?? null);
                  setUploadError(null);
                }}
                disabled={uploading}
                className="w-full text-sm mb-2 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-sorena-navy file:text-white file:text-xs file:font-semibold file:cursor-pointer hover:file:bg-[#162d4a] disabled:opacity-50"
              />

              {pickedFile && (
                <div className="text-xs text-[#4A4A4A]/80 mb-2 flex items-center gap-1.5">
                  <FileText size={12} />
                  <span className="truncate">{pickedFile.name}</span>
                  <span className="text-[#4A4A4A]/60">· {formatBytes(pickedFile.size)}</span>
                  {!ALLOWED_LICENCE_MIMES.includes(pickedFile.type as (typeof ALLOWED_LICENCE_MIMES)[number]) && (
                    <span className="ml-1 text-red-700">— PDF, PNG, or JPG only</span>
                  )}
                  {pickedFile.size > MAX_LICENCE_BYTES && (
                    <span className="ml-1 text-red-700">— exceeds 10 MB</span>
                  )}
                </div>
              )}

              {profile.verificationState === 'VERIFIED' && (
                <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>Re-uploading will clear your verified status. An OWNER will need to re-verify.</span>
                </div>
              )}

              {uploadError && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                  {uploadError}
                </div>
              )}

              <Button
                type="button"
                variant="primary"
                size="md"
                disabled={!fileIsValid || uploading}
                onClick={onUpload}
                className="w-full sm:w-auto"
              >
                <Upload size={16} className="mr-2" />
                {uploading ? 'Uploading…' : 'Upload'}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Status banner ───────────────────────────────────────────────────────

function StatusBanner({ profile }: { profile: LiaProfileResponse }) {
  const state = profile.verificationState;
  const incomplete = !profile.iaaLicenceNumber || !profile.iaaLicenceFileName;

  if (state === 'VERIFIED') {
    return (
      <BannerCard tone="green" Icon={CheckCircle2} title="Verified">
        Verified on {formatDate(profile.iaaLicenceVerifiedAt)}. You're eligible for contract auto-assignment.
      </BannerCard>
    );
  }
  if (state === 'REJECTED') {
    return (
      <BannerCard tone="red" Icon={XCircle} title="Rejected">
        On {formatDate(profile.lastRejectionAt)}:{' '}
        <span className="italic">&ldquo;{profile.lastRejectionReason ?? 'No reason recorded.'}&rdquo;</span>{' '}
        Update your details below and re-upload to resubmit.
      </BannerCard>
    );
  }
  // PENDING
  if (incomplete) {
    return (
      <BannerCard tone="gray" Icon={Hourglass} title="Incomplete">
        Enter your IAA licence number and upload your licence PDF to start the verification process.
      </BannerCard>
    );
  }
  return (
    <BannerCard tone="amber" Icon={Hourglass} title="Awaiting review">
      Your licence is in the OWNER review queue. You'll see a status change here once it's verified or returned.
    </BannerCard>
  );
}

function BannerCard({
  tone,
  Icon,
  title,
  children,
}: {
  tone: 'green' | 'red' | 'amber' | 'gray';
  Icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  const styles = {
    green: { wrap: 'border-emerald-200 bg-emerald-50', icon: 'text-emerald-700', title: 'text-emerald-900', body: 'text-emerald-900' },
    red:   { wrap: 'border-rose-200 bg-rose-50',       icon: 'text-rose-700',    title: 'text-rose-900',    body: 'text-rose-900' },
    amber: { wrap: 'border-amber-200 bg-amber-50',     icon: 'text-amber-700',   title: 'text-amber-900',   body: 'text-amber-900' },
    gray:  { wrap: 'border-gray-200 bg-gray-50',       icon: 'text-gray-600',    title: 'text-gray-800',    body: 'text-gray-700' },
  }[tone];

  return (
    <Card className={`${styles.wrap}`}>
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          <Icon size={22} className={`flex-shrink-0 mt-0.5 ${styles.icon}`} />
          <div className="flex-1">
            <div className={`text-sm font-bold ${styles.title}`}>{title}</div>
            <div className={`text-sm mt-0.5 ${styles.body}`}>{children}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null | undefined): string {
  // Day-first NZ style ("8 Jul 2026") via the shared helper.
  return iso ? fmtDate(iso) : '—';
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}
