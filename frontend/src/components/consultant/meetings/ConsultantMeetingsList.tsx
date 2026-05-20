'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Edit2, X as XIcon, CheckCircle } from 'lucide-react';
import { MeetingStatusBadge } from '@/components/student/meetings/MeetingStatusBadge';
import { MeetingFormOverlay, type MeetingFormInitial } from './MeetingFormOverlay';
import { CancelMeetingOverlay } from './CancelMeetingOverlay';
import { ConsultantMeetingDetailOverlay } from './ConsultantMeetingDetailOverlay';

// PR-DASH-3 — Consultant meetings list.
//
// Reuses the student-side MeetingStatusBadge for visual parity (same
// colour scheme either way). Each row has inline actions: open
// detail (default), edit, cancel, complete. The detail overlay
// hosts the transcript picker + notes editor.

export interface ConsultantMeetingRow {
  id: string;
  studentId: string;
  studentName: string | null;
  consultantId: string | null;
  consultantName: string | null;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  meetingType: string;
  hasTranscript: boolean;
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

const TYPE_KEY: Record<string, string> = {
  CONSULTATION:    'meetings.type.consultation',
  FOLLOW_UP:       'meetings.type.followUp',
  DOCUMENT_REVIEW: 'meetings.type.documentReview',
  ASSESSMENT:      'meetings.type.assessment',
};

type Dialog =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; initial: MeetingFormInitial }
  | { kind: 'cancel'; id: string }
  | { kind: 'detail'; id: string };

export function ConsultantMeetingsList({
  meetings,
}: {
  meetings: ConsultantMeetingRow[];
}) {
  const t = useTranslations();
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <h1 className="text-2xl font-bold text-sorena-navy md:text-3xl">
          {t('meetings.title')}
        </h1>
        <button
          type="button"
          onClick={() => setDialog({ kind: 'create' })}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-sorena-navy px-6 text-base font-semibold text-white transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy focus-visible:ring-offset-2"
        >
          <Plus size={18} />
          {t('meetings.consultant.create')}
        </button>
      </div>

      {meetings.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          {t('meetings.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {meetings.map((m) => (
            <li key={m.id}>
              <div className="flex flex-col items-stretch gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm md:flex-row md:items-center">
                <button
                  type="button"
                  onClick={() => setDialog({ kind: 'detail', id: m.id })}
                  className="flex-1 text-left"
                >
                  <p className="text-sm font-semibold text-sorena-navy">
                    {m.studentName ?? m.studentId}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-700">
                    {formatDateTime(m.scheduledAt)} · {m.durationMinutes} min
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {t(TYPE_KEY[m.meetingType] as Parameters<typeof t>[0])}
                  </p>
                </button>

                <div className="flex items-center justify-between gap-2 md:justify-end">
                  <MeetingStatusBadge status={m.status} />
                  {m.status === 'SCHEDULED' && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        title={t('meetings.consultant.edit')}
                        onClick={() => setDialog({
                          kind: 'edit',
                          initial: {
                            id:             m.id,
                            studentId:      m.studentId,
                            scheduledAt:    m.scheduledAt,
                            durationMinutes: m.durationMinutes,
                            meetingType:    m.meetingType,
                            locationOrLink: null,
                            agenda:         null,
                          },
                        })}
                        className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        type="button"
                        title={t('meetings.consultant.complete')}
                        onClick={async () => {
                          const { api } = await import('@/lib/api');
                          await api.post(`/api/consultant/meetings/${m.id}/complete`, {});
                          window.location.reload();
                        }}
                        className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50"
                      >
                        <CheckCircle size={16} />
                      </button>
                      <button
                        type="button"
                        title={t('meetings.consultant.cancel')}
                        onClick={() => setDialog({ kind: 'cancel', id: m.id })}
                        className="rounded-lg p-2 text-rose-600 hover:bg-rose-50"
                      >
                        <XIcon size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog.kind === 'create' && (
        <MeetingFormOverlay
          mode="create"
          onClose={() => setDialog({ kind: 'none' })}
          onSaved={() => window.location.reload()}
        />
      )}
      {dialog.kind === 'edit' && (
        <MeetingFormOverlay
          mode="edit"
          initial={dialog.initial}
          onClose={() => setDialog({ kind: 'none' })}
          onSaved={() => window.location.reload()}
        />
      )}
      {dialog.kind === 'cancel' && (
        <CancelMeetingOverlay
          meetingId={dialog.id}
          onClose={() => setDialog({ kind: 'none' })}
          onCancelled={() => window.location.reload()}
        />
      )}
      {dialog.kind === 'detail' && (
        <ConsultantMeetingDetailOverlay
          meetingId={dialog.id}
          onClose={() => setDialog({ kind: 'none' })}
          onChanged={() => window.location.reload()}
        />
      )}
    </div>
  );
}
