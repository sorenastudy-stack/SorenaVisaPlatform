'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { MeetingStatusBadge } from '@/components/student/meetings/MeetingStatusBadge';
import { TranscriptMetadataPicker } from './TranscriptMetadataPicker';
import { TranscriptNotesEditor } from './TranscriptNotesEditor';

// PR-DASH-3 — Consultant-side meeting detail overlay.
//
// Hosts the transcript picker and the notes editor. Unlike the
// student-side overlay (read-only), this one IS where the
// consultant does the post-meeting work.

interface MeetingDetail {
  id: string;
  studentId: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  meetingType: string;
  locationOrLink: string | null;
  agenda: string | null;
  transcriptNotes: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  studentName: string | null;
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

export function ConsultantMeetingDetailOverlay({
  meetingId,
  onClose,
  onChanged,
}: {
  meetingId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations();
  const [data, setData] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      const res = await api.get<MeetingDetail>(`/api/consultant/meetings/${meetingId}`);
      setData(res);
    } catch {
      // 404 closes
      onClose();
    }
  };

  useEffect(() => {
    let cancelled = false;
    api
      .get<MeetingDetail>(`/api/consultant/meetings/${meetingId}`)
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) onClose(); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [meetingId, onClose]);

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

        {loading && <p className="text-sm text-slate-500">Loading…</p>}
        {data && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-bold text-sorena-navy">
                {data.studentName ?? data.studentId}
              </h2>
              <p className="mt-1 text-sm text-slate-700">
                {formatDateTime(data.scheduledAt)} · {data.durationMinutes} min
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <MeetingStatusBadge status={data.status} />
              </div>
            </div>

            {data.locationOrLink && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                  Location / link
                </p>
                <p className="mt-1 break-all text-sm text-slate-800">
                  {data.locationOrLink}
                </p>
              </div>
            )}

            {data.agenda && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                  Agenda
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                  {data.agenda}
                </p>
              </div>
            )}

            {data.cancelledAt && data.cancelledReason && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-wide text-rose-700">
                  Cancelled
                </p>
                <p className="mt-1 text-sm text-rose-800">
                  {data.cancelledReason}
                </p>
              </div>
            )}

            <TranscriptMetadataPicker
              meetingId={data.id}
              initial={data.transcriptFile}
              onChanged={() => { void reload(); onChanged(); }}
            />
            <TranscriptNotesEditor
              meetingId={data.id}
              initial={data.transcriptNotes}
            />
          </div>
        )}
      </div>
    </div>
  );
}
