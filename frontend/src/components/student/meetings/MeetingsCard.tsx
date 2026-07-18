'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Video } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatDateTime as fmtDateTime } from '@/lib/date';

// PR-DASH-3 — Dashboard summary card for meetings.
//
// Replaces PR-DASH-1's "Meetings" placeholder. Shows
// the upcoming count + next meeting's date/type, plus a link to
// the full /student/meetings page. The detail of "next" is small
// (date + type + consultant initial) — students who want more click
// through.

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

export interface DashboardMeetingsSummary {
  upcomingCount: number;
  next: {
    id: string;
    scheduledAt: string;
    meetingType: string;
    consultantName: string | null;
  } | null;
}

export function MeetingsCard({ summary }: { summary: DashboardMeetingsSummary }) {
  const t = useTranslations();
  return (
    <Card className="bg-white animate-fade-in-up">
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="rounded-lg bg-[#1e3a5f]/5 p-2 text-sorena-navy">
          <Video size={20} />
        </div>
        <CardTitle>{t('meetings.title')}</CardTitle>
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
          {summary.upcomingCount}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {summary.next ? (
          <div className="rounded-xl border border-sorena-navy/15 bg-sorena-navy/5 p-3">
            <p className="text-sm font-semibold text-sorena-navy">
              {formatDateTime(summary.next.scheduledAt)}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              {t(TYPE_KEY[summary.next.meetingType] as Parameters<typeof t>[0])}
              {summary.next.consultantName ? ` · ${summary.next.consultantName}` : ''}
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-600">{t('meetings.empty')}</p>
        )}
        <Link
          href="/student/meetings"
          className="text-center text-sm font-semibold text-sorena-navy hover:underline"
        >
          {t('meetings.title')} →
        </Link>
      </CardContent>
    </Card>
  );
}
