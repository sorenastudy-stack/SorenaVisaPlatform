'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CalendarDays, PhoneCall, CalendarClock, AlertTriangle, CheckCircle2,
  Loader2, ArrowRight, Clock,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { formatRelativeTime } from '@/lib/format-relative-time';

// PR-DIARY — "My day": a live agenda of the caller's nurture call tasks +
// consultation meetings, split into Today and Missed/overdue. Read-only — actions
// route to the existing surfaces (Follow-ups for calls, My Meetings for meetings),
// so the outcome / mark-status logic is never duplicated here.

interface DiaryCall {
  id: string; step: number; dueDate: string;
  leadId: string; clientId: string | null; clientName: string | null; reason: string | null;
}
interface DiaryMeeting {
  id: string; type: string; status: string; scheduledAt: string | null; clientName: string | null;
}
interface DiaryResponse {
  today:  { meetings: DiaryMeeting[]; calls: DiaryCall[] };
  missed: { meetings: DiaryMeeting[]; calls: DiaryCall[] };
}

const CALL_STEP: Record<number, string> = { 2: 'Call 1', 4: 'Call 2', 7: 'Final call' };
const MEETING_LABEL: Record<string, string> = {
  FREE_15: 'Free 15-min consult', GAP_CLOSING: 'Gap-closing session', LIA: 'LIA consultation', ADMISSION: 'Admission session',
};

export function DiaryClient() {
  const [data, setData] = useState<DiaryResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get<DiaryResponse>('/staff/diary').then(setData).catch(() => setError(true));
  }, []);

  const todayCount = (data?.today.calls.length ?? 0) + (data?.today.meetings.length ?? 0);
  const missedCount = (data?.missed.calls.length ?? 0) + (data?.missed.meetings.length ?? 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10 space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <CalendarDays size={22} className="text-[#1e3a5f]" />
          <h1 className="text-2xl font-bold text-[#1e3a5f]">My day</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Your calls and meetings for today, plus anything overdue. Actions open on their own screens.
        </p>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">Couldn’t load your day. Please refresh.</div>}
      {!data && !error && (
        <Card><CardContent><div className="flex items-center gap-2 py-8 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /> Loading…</div></CardContent></Card>
      )}

      {/* ── Missed / overdue (first — needs attention) ─────────────────── */}
      {data && (
        <Section
          icon={<AlertTriangle size={16} className="text-rose-500" />}
          title="Missed / overdue"
          subtitle="From earlier days and still open — clear these first."
          count={missedCount}
          tone="danger"
        >
          {missedCount === 0 ? (
            <Empty title="Nothing overdue" sub="You’re on top of your follow-ups and sessions." />
          ) : (
            <div className="space-y-2">
              {data.missed.calls.map((c) => <CallRow key={c.id} c={c} overdue />)}
              {data.missed.meetings.map((m) => <MeetingRow key={m.id} m={m} overdue />)}
            </div>
          )}
        </Section>
      )}

      {/* ── Today ──────────────────────────────────────────────────────── */}
      {data && (
        <Section
          icon={<CalendarClock size={16} className="text-[#b8941f]" />}
          title="Today"
          subtitle="Calls due and sessions scheduled for today."
          count={todayCount}
        >
          {todayCount === 0 ? (
            <Empty title="Nothing scheduled today" sub="No calls due or meetings booked for today." />
          ) : (
            <div className="space-y-2">
              {data.today.calls.map((c) => <CallRow key={c.id} c={c} />)}
              {data.today.meetings.map((m) => <MeetingRow key={m.id} m={m} />)}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

// ── Rows: read-only; the action LINKS to the existing surface ────────────────
function CallRow({ c, overdue }: { c: DiaryCall; overdue?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${overdue ? 'border-rose-100 bg-rose-50/40' : 'border-gray-100 bg-white'}`}>
      <div className="flex items-center gap-3 min-w-0">
        <PhoneCall size={16} className="shrink-0 text-[#1e3a5f]" />
        <div className="min-w-0">
          <Link href={`/staff/leads/${c.leadId}`} className="font-medium text-[#1e3a5f] hover:underline">{c.clientName ?? '—'}</Link>
          <div className="text-xs text-gray-500">
            <span className="font-semibold text-[#b8941f]">{CALL_STEP[c.step] ?? `Call step ${c.step}`}</span>
            {c.reason ? ` · ${c.reason}` : ''} · <span className="whitespace-nowrap">{overdue ? 'due' : ''} {formatRelativeTime(c.dueDate)}</span>
          </div>
        </div>
      </div>
      {/* Action lives on Follow-ups — no duplicated outcome logic here. */}
      <Link href="/staff/follow-ups" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#1e3a5f] hover:underline whitespace-nowrap">
        Log outcome <ArrowRight size={12} />
      </Link>
    </div>
  );
}

function MeetingRow({ m, overdue }: { m: DiaryMeeting; overdue?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${overdue ? 'border-rose-100 bg-rose-50/40' : 'border-gray-100 bg-white'}`}>
      <div className="flex items-center gap-3 min-w-0">
        <CalendarClock size={16} className="shrink-0 text-[#1e3a5f]" />
        <div className="min-w-0">
          <span className="font-medium text-[#1e3a5f]">{m.clientName ?? '—'}</span>
          <div className="text-xs text-gray-500">
            <span className="font-semibold text-[#b8941f]">{MEETING_LABEL[m.type] ?? m.type}</span>
            {' · '}<span className="uppercase tracking-wide text-[10px]">{m.status}</span>
            {m.scheduledAt && <> · <span className="inline-flex items-center gap-1 whitespace-nowrap"><Clock size={11} />{formatRelativeTime(m.scheduledAt)}</span></>}
          </div>
        </div>
      </div>
      {/* Action lives on My Meetings (staffMarkStatus) — not duplicated here. */}
      <Link href="/staff/meetings" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#1e3a5f] hover:underline whitespace-nowrap">
        {overdue ? 'Mark outcome' : 'Open'} <ArrowRight size={12} />
      </Link>
    </div>
  );
}

// ── Presentational helpers ──────────────────────────────────────────────────
function Section({ icon, title, subtitle, count, tone, children }: {
  icon: React.ReactNode; title: string; subtitle: string; count: number; tone?: 'danger'; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-gray-500">{icon} {title}</h2>
            <p className="mt-1 text-xs text-gray-400">{subtitle}</p>
          </div>
          {count > 0 && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tone === 'danger' ? 'bg-rose-100 text-rose-700' : 'bg-[#1e3a5f]/10 text-[#1e3a5f]'}`}>{count}</span>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="py-8 text-center">
      <CheckCircle2 size={26} className="mx-auto mb-2 text-[#c9a961]" />
      <p className="text-sm font-medium text-[#4A4A4A]">{title}</p>
      <p className="mt-1 text-xs text-gray-400">{sub}</p>
    </div>
  );
}
