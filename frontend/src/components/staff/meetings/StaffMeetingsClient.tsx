'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Loader2, Video, CalendarPlus, X, CalendarDays, List as ListIcon } from 'lucide-react';
import { Calendar, dateFnsLocalizer, Views, type View } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { api, ApiError } from '@/lib/api';
import { downloadIcs, type IcsMeeting } from '@/lib/ics';

// Staff "My Meetings" — the signed-in staff member's own consultation sessions.
// A read-only calendar (Day / Work Week / Month, primary) plus a flat
// Upcoming / Past list (secondary tab). Each upcoming meeting exposes the stored
// Jitsi "Join" link and an "Add to calendar" (.ics) download. Data from
// GET /staff/bookings, server-scoped to assignedToId = the JWT user (admin tier
// sees all) — no userId is sent from the client.
//
// A 403 (role not entitled to the bookings surface) is treated as "no meetings"
// — a warm empty state, never an error wall.

interface Row {
  id: string;
  type: string;
  status: string;
  // PR-CONTRACT-GATE (Phase A) — the LIA verdict on an LIA session, if recorded.
  decision: string | null;
  scheduledAt: string | null;
  scheduledEndAt: string | null;
  durationMinutes: number | null;
  timezone: string | null;
  meetingLink: string | null;
  staffName: string | null;
  clientName: string;
}

const TYPE_LABEL: Record<string, string> = {
  FREE_15: 'Free 15-min', GAP_CLOSING: 'Gap-Closing', LIA: 'LIA', ADMISSION: 'Admission',
};
const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  BOOKED: 'bg-[#c9a961]/15 text-[#8a6d10] border border-[#c9a961]/40',
  COMPLETED: 'bg-[#1e3a5f]/10 text-[#1e3a5f] border border-[#1e3a5f]/20',
  CANCELLED: 'bg-gray-100 text-gray-500 border border-gray-200',
  NO_SHOW: 'bg-red-50 text-red-600 border border-red-200',
};

const localizer = dateFnsLocalizer({
  format, parse, startOfWeek, getDay, locales: { 'en-US': enUS },
});
const CAL_VIEWS: View[] = [Views.MONTH, Views.WORK_WEEK, Views.DAY];

function fmt(iso: string | null, tz: string | null): string {
  if (!iso) return 'Time to be confirmed';
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: tz ?? 'Pacific/Auckland', weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

function isUpcoming(r: Row): boolean {
  return !!r.scheduledAt
    && new Date(r.scheduledAt).getTime() >= Date.now()
    && r.status !== 'CANCELLED' && r.status !== 'NO_SHOW';
}

function toIcs(r: Row): IcsMeeting {
  return {
    id: r.id,
    clientName: r.clientName,
    typeLabel: TYPE_LABEL[r.type] ?? r.type,
    scheduledAt: r.scheduledAt as string,
    scheduledEndAt: r.scheduledEndAt,
    durationMinutes: r.durationMinutes,
    meetingLink: r.meetingLink,
  };
}

export function StaffMeetingsClient() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tab, setTab] = useState<'calendar' | 'list'>('calendar');
  const [view, setView] = useState<View>(Views.WORK_WEEK);
  const [date, setDate] = useState<Date>(new Date());
  const [selected, setSelected] = useState<Row | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<Row[]>('/staff/bookings')
      .then((r) => { if (alive) { setRows(r); setState('ready'); } })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.statusCode === 403) { setRows([]); setState('ready'); }
        else setState('error');
      });
    return () => { alive = false; };
  }, []);

  const now = Date.now();
  const dated = useMemo(() => (rows ?? []).filter((r) => r.scheduledAt), [rows]);
  const upcoming = useMemo(() => dated
    .filter((r) => isUpcoming(r))
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime()), [dated]);
  const past = useMemo(() => dated
    .filter((r) => !isUpcoming(r))
    .sort((a, b) => new Date(b.scheduledAt!).getTime() - new Date(a.scheduledAt!).getTime()), [dated]);

  const events = useMemo(() => dated.map((r) => {
    const start = new Date(r.scheduledAt!);
    const end = r.scheduledEndAt
      ? new Date(r.scheduledEndAt)
      : new Date(start.getTime() + (r.durationMinutes ?? 30) * 60_000);
    return { id: r.id, title: `${TYPE_LABEL[r.type] ?? r.type} · ${r.clientName}`, start, end, resource: r };
  }), [dated]);

  const hasAny = upcoming.length > 0 || past.length > 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClock size={20} className="text-[#1e3a5f]" />
            <h1 className="text-2xl font-bold text-[#1e3a5f]">My Meetings</h1>
          </div>
          <p className="mt-1 text-sm text-[#4A4A4A]/70">Your upcoming and past consultation sessions.</p>
        </div>
        {state === 'ready' && hasAny && (
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1">
            <TabButton active={tab === 'calendar'} onClick={() => setTab('calendar')} icon={<CalendarDays size={15} />} label="Calendar" />
            <TabButton active={tab === 'list'} onClick={() => setTab('list')} icon={<ListIcon size={15} />} label="List" />
          </div>
        )}
      </div>

      {state === 'loading' && (
        <div className="flex items-center gap-2 py-16 text-[#4A4A4A]/60">
          <Loader2 size={18} className="animate-spin" /> Loading your meetings…
        </div>
      )}

      {state === 'error' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn&apos;t load your meetings just now. Please refresh.
        </div>
      )}

      {state === 'ready' && !hasAny && <EmptyState />}

      {state === 'ready' && hasAny && tab === 'calendar' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-2 md:p-3" style={{ height: 680 }}>
          <Calendar
            localizer={localizer}
            events={events}
            startAccessor="start"
            endAccessor="end"
            view={view}
            onView={(v) => setView(v)}
            date={date}
            onNavigate={(d) => setDate(d)}
            views={CAL_VIEWS}
            popup
            onSelectEvent={(e: any) => setSelected(e.resource as Row)}
            eventPropGetter={eventPropGetter}
            tooltipAccessor={(e: any) => `${e.resource.clientName} — ${e.resource.status}`}
            style={{ height: '100%' }}
          />
        </div>
      )}

      {state === 'ready' && hasAny && tab === 'list' && (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <Section title="Upcoming">
              {upcoming.map((b) => <MeetingCard key={b.id} b={b} />)}
            </Section>
          )}
          {past.length > 0 && (
            <Section title="Past">
              {past.slice(0, 20).map((b) => <MeetingCard key={b.id} b={b} muted />)}
            </Section>
          )}
        </div>
      )}

      {selected && (
        <MeetingDetail
          row={selected}
          onClose={() => setSelected(null)}
          // PR-CONTRACT-GATE — after an LIA records a verdict the session is also
          // marked COMPLETED; reflect both in the calendar/list without a refetch.
          onRecorded={(u) => {
            setRows((prev) =>
              (prev ?? []).map((r) => (r.id === u.id ? { ...r, status: u.status, decision: u.decision } : r)),
            );
            setSelected((prev) => (prev && prev.id === u.id ? { ...prev, status: u.status, decision: u.decision } : prev));
          }}
        />
      )}
    </div>
  );
}

// Color events by status; strike-through cancelled/no-show.
function eventPropGetter(event: any) {
  const s: string = event.resource.status;
  const bg =
    s === 'CONFIRMED' ? '#d1fae5' :
    s === 'COMPLETED' ? '#e0e7ff' :
    (s === 'CANCELLED' || s === 'NO_SHOW') ? '#f3f4f6' :
    '#f7ecc9';
  return {
    style: {
      backgroundColor: bg,
      color: '#1e3a5f',
      border: 'none',
      borderRadius: '6px',
      fontSize: '12px',
      padding: '1px 5px',
      textDecoration: (s === 'CANCELLED' || s === 'NO_SHOW') ? 'line-through' : 'none',
    },
  };
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
        active ? 'bg-[#1e3a5f] text-white' : 'text-[#1e3a5f] hover:bg-[#1e3a5f]/5',
      ].join(' ')}
    >
      {icon} {label}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#4A4A4A]/60">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function JoinLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#1e3a5f] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#162d4a] transition-colors"
    >
      <Video size={14} /> Join
    </a>
  );
}

function AddToCalendar({ row }: { row: Row }) {
  return (
    <button
      type="button"
      onClick={() => downloadIcs(toIcs(row))}
      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#1e3a5f]/30 px-3.5 py-2 text-xs font-semibold text-[#1e3a5f] hover:bg-[#1e3a5f]/5 transition-colors"
    >
      <CalendarPlus size={14} /> Add to calendar
    </button>
  );
}

function MeetingCard({ b, muted }: { b: Row; muted?: boolean }) {
  const upcoming = isUpcoming(b);
  return (
    <div className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:p-5 ${muted ? 'opacity-80' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[#1e3a5f]">{b.clientName}</span>
            <span className="rounded-full bg-[#c9a961]/20 px-2 py-0.5 text-[11px] font-medium text-[#8a6d10]">
              {TYPE_LABEL[b.type] ?? b.type}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[b.status] ?? 'bg-gray-100 text-gray-500'}`}>
              {b.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-[#4A4A4A]/70">
            {fmt(b.scheduledAt, b.timezone)}{b.staffName ? ` · ${b.staffName}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {upcoming && b.meetingLink && <JoinLink href={b.meetingLink} />}
          {upcoming && b.scheduledAt && <AddToCalendar row={b} />}
        </div>
      </div>
    </div>
  );
}

// Detail popover for a calendar event — client, time, Join + Add to calendar.
function MeetingDetail({
  row,
  onClose,
  onRecorded,
}: {
  row: Row;
  onClose: () => void;
  onRecorded: (u: { id: string; status: string; decision: string | null }) => void;
}) {
  const upcoming = isUpcoming(row);
  // PR-CONTRACT-GATE — the verdict action shows only on LIA sessions that are
  // still actionable (a cancelled / no-show session can't carry a legal verdict).
  const canRecordVerdict = row.type === 'LIA' && row.status !== 'CANCELLED' && row.status !== 'NO_SHOW';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-gray-400 hover:text-gray-700">
          <X size={18} />
        </button>
        <p className="text-xs uppercase tracking-wide text-[#4A4A4A]/60">{TYPE_LABEL[row.type] ?? row.type}</p>
        <h3 className="mt-1 text-lg font-bold text-[#1e3a5f]">{row.clientName}</h3>
        <p className="mt-1 text-sm text-[#4A4A4A]/70">{fmt(row.scheduledAt, row.timezone)}</p>
        <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[row.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {row.status}
        </span>
        <div className="mt-4 flex flex-wrap gap-2">
          {upcoming && row.meetingLink && <JoinLink href={row.meetingLink} />}
          {row.scheduledAt && <AddToCalendar row={row} />}
        </div>
        {!upcoming && !canRecordVerdict && (
          <p className="mt-3 text-xs text-[#4A4A4A]/50">This session has passed.</p>
        )}
        {canRecordVerdict && <LiaDecisionPanel row={row} onRecorded={onRecorded} />}
      </div>
    </div>
  );
}

// PR-CONTRACT-GATE (Phase A) — the LIA records their verdict on an LIA session.
// APPROVED unlocks contract sending for the (red-flagged) case; the other three
// keep it locked. Recording also marks the session COMPLETED server-side.
const DECISION_LABEL: Record<string, string> = {
  APPROVED: 'Approved', REJECTED: 'Declined', NEEDS_MORE_INFO: 'Needs more info', WITHDRAWN: 'Withdrawn',
};
const DECISION_ACTIONS: { value: string; label: string; className: string }[] = [
  { value: 'APPROVED', label: 'Approve', className: 'bg-emerald-600 text-white hover:bg-emerald-700' },
  { value: 'NEEDS_MORE_INFO', label: 'Needs info', className: 'bg-[#c9a961]/20 text-[#8a6d10] hover:bg-[#c9a961]/30 border border-[#c9a961]/40' },
  { value: 'REJECTED', label: 'Decline', className: 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200' },
  { value: 'WITHDRAWN', label: 'Withdraw', className: 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200' },
];

function LiaDecisionPanel({
  row,
  onRecorded,
}: {
  row: Row;
  onRecorded: (u: { id: string; status: string; decision: string | null }) => void;
}) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function record(decision: string) {
    setSaving(decision);
    setError(null);
    try {
      const res = await api.post<{ id: string; status: string; decision: string | null }>(
        `/staff/consultations/${row.id}/decision`,
        { decision, notes: notes.trim() || undefined },
      );
      onRecorded({ id: res.id, status: res.status, decision: res.decision });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the verdict — please try again.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-[#1e3a5f]/15 bg-[#f7f9fc] p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#1e3a5f]/70">Legal review verdict</p>
      {row.decision ? (
        <p className="mt-1 text-xs text-[#4A4A4A]/70">
          Recorded: <span className="font-semibold">{DECISION_LABEL[row.decision] ?? row.decision}</span>. Selecting again updates it.
        </p>
      ) : (
        <p className="mt-1 text-xs text-[#4A4A4A]/60">
          Record your verdict for this case. Approving unlocks contract sending.
        </p>
      )}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        rows={2}
        className="mt-2 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:border-[#1e3a5f]/40 focus:outline-none"
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        {DECISION_ACTIONS.map((d) => (
          <button
            key={d.value}
            type="button"
            disabled={!!saving}
            onClick={() => record(d.value)}
            className={`inline-flex min-h-[36px] items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${d.className}`}
          >
            {saving === d.value ? <Loader2 size={13} className="animate-spin" /> : d.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-[#c9a961]/40 bg-[#faf8f3] py-16 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#c9a961]/15">
        <CalendarClock size={26} className="text-[#b8941f]" />
      </div>
      <p className="text-lg font-bold text-[#1e3a5f]">No meetings yet</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[#4A4A4A]/60">
        They&apos;ll appear here once clients book a session with you.
      </p>
    </div>
  );
}
