'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { MeetingStatusBadge } from './MeetingStatusBadge';

// PR-DASH-3 — Student-side meeting detail overlay.
//
// Inline overlay modal — same pattern as PR-DASH-2's CloseTicketDialog
// (no shadcn Dialog primitive). Click backdrop / ESC to close.
// Read-only for students; surfaces locationOrLink + agenda +
// transcript file metadata + transcript notes (all decrypted by
// the backend before transmission).

interface MeetingDetail {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  meetingType: string;
  locationOrLink: string | null;
  agenda: string | null;
  transcriptNotes: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  consultantName: string | null;
  transcriptFile: {
    id: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
  } | null;
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

const TYPE_KEY: Record<string, string> = {
  CONSULTATION:    'meetings.type.consultation',
  FOLLOW_UP:       'meetings.type.followUp',
  DOCUMENT_REVIEW: 'meetings.type.documentReview',
  ASSESSMENT:      'meetings.type.assessment',
};

export function MeetingDetailOverlay({
  meetingId,
  onClose,
}: {
  meetingId: string;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [data, setData] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<MeetingDetail>(`/api/student/meetings/${meetingId}`)
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setError(t('meetings.errors.notFound') as string); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [meetingId, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-lg p-1 text-slate-500 hover:bg-slate-100"
        >
          <X size={18} />
        </button>

        {loading && (
          <p className="text-sm text-slate-500">{t('meetings.empty')}</p>
        )}
        {error && (
          <p className="text-sm text-rose-600">{error}</p>
        )}
        {data && (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t(TYPE_KEY[data.meetingType] as Parameters<typeof t>[0])}
              </p>
              <h2 className="mt-1 text-xl font-bold text-sorena-navy">
                {formatDateTime(data.scheduledAt)}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <MeetingStatusBadge status={data.status} />
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                  {data.durationMinutes} min
                </span>
              </div>
              {data.consultantName && (
                <p className="mt-2 text-sm text-slate-700">
                  {data.consultantName}
                </p>
              )}
            </div>

            {data.locationOrLink && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Location / link
                </p>
                <p className="mt-1 break-all text-sm text-slate-800">
                  {data.locationOrLink}
                </p>
              </div>
            )}

            {data.agenda && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Agenda
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                  {data.agenda}
                </p>
              </div>
            )}

            {data.cancelledAt && data.cancelledReason && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                  Cancelled
                </p>
                <p className="mt-1 text-sm text-rose-800">
                  {data.cancelledReason}
                </p>
              </div>
            )}

            {/* Transcript section */}
            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-sm font-bold text-sorena-navy">
                {t('meetings.transcript.title')}
              </h3>

              <div className="mt-3">
                {data.transcriptFile ? (
                  <div className="flex items-center gap-3 rounded-lg border border-sorena-navy/15 bg-sorena-navy/5 px-3 py-2">
                    <FileText size={18} className="text-sorena-navy" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-sorena-navy">
                        {data.transcriptFile.originalFilename}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatSize(data.transcriptFile.sizeBytes)} · {data.transcriptFile.mimeType}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    {t('meetings.transcript.noFile')}
                  </p>
                )}
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t('meetings.transcript.notes')}
                </p>
                {data.transcriptNotes ? (
                  <div className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-800">
                    {data.transcriptNotes}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    {t('meetings.transcript.noNotes')}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
