'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MeetingStatusBadge } from './MeetingStatusBadge';
import { MeetingDetailOverlay } from './MeetingDetailOverlay';
import { BookMeetingButton } from './BookMeetingButton';
import { formatDateTime as fmtDateTime } from '@/lib/date';

// PR-DASH-3 — Student meetings list.
//
// Read-only. Click a row → inline overlay modal with full detail
// (no shadcn Dialog primitive — same pattern as PR-DASH-2's
// CloseTicketDialog). Empty state shows the book CTA below the
// "no meetings yet" message when the env var is configured.

export interface MeetingRow {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  meetingType: string;
  studentName: string | null;
  consultantName: string | null;
  hasTranscript: boolean;
}

function formatDateTime(iso: string): string {
  // Day-first NZ style ("8 Jul 2026, 1:30 pm").
  return fmtDateTime(iso);
}

const TYPE_KEY: Record<string, string> = {
  CONSULTATION:    'meetings.type.consultation',
  FOLLOW_UP:       'meetings.type.followUp',
  DOCUMENT_REVIEW: 'meetings.type.documentReview',
  ASSESSMENT:      'meetings.type.assessment',
};

export function MeetingsList({ meetings }: { meetings: MeetingRow[] }) {
  const t = useTranslations();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold text-sorena-navy md:text-3xl">
            {t('meetings.title')}
          </h1>
          <p className="mt-1 text-sm text-[#4A4A4A]/70">Your booked sessions with the Sorena team.</p>
        </div>
        <BookMeetingButton />
      </div>

      {meetings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-600">{t('meetings.empty')}</p>
          <div className="mt-4 flex justify-center">
            <BookMeetingButton />
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {meetings.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setSelectedId(m.id)}
                className="w-full rounded-xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-sorena-navy">
                      {formatDateTime(m.scheduledAt)}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {t(TYPE_KEY[m.meetingType] as Parameters<typeof t>[0])}
                      {m.consultantName ? ` · ${m.consultantName}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 whitespace-nowrap">
                    <MeetingStatusBadge status={m.status} />
                    <p className="text-xs text-slate-500">
                      {m.durationMinutes} min
                    </p>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedId && (
        <MeetingDetailOverlay
          meetingId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
