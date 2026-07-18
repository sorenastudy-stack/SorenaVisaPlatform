'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// Staff "My Meetings" — replaces the old placeholder panel. A read-only view
// of the signed-in staff member's own consultation sessions,
// split Upcoming / Past. Reuses GET /staff/bookings, which the server scopes
// to `assignedToId = req.user.userId` (admin tier sees all) — no userId is
// ever sent from the client. Actioning a booking (no-show / complete / cancel)
// lives on /staff/bookings; this surface is the calendar-style read.
//
// Roles not entitled to the bookings endpoint (e.g. SUPPORT) get a 403, which
// we treat as "no meetings" — a warm empty state, never an error wall.

interface Row {
  id: string;
  type: string;
  status: string;
  scheduledAt: string | null;
  timezone: string | null;
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

function fmt(iso: string | null, tz: string | null): string {
  if (!iso) return 'Time to be confirmed';
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: tz ?? 'Pacific/Auckland', weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

export function StaffMeetingsClient() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    api.get<Row[]>('/staff/bookings')
      .then((r) => { if (alive) { setRows(r); setState('ready'); } })
      .catch((e) => {
        if (!alive) return;
        // 403 = this role has no bookings surface → treat as empty, not error.
        if (e instanceof ApiError && e.statusCode === 403) { setRows([]); setState('ready'); }
        else setState('error');
      });
    return () => { alive = false; };
  }, []);

  const now = Date.now();
  const dated = (rows ?? []).filter((r) => r.scheduledAt);
  const upcoming = dated
    .filter((r) => new Date(r.scheduledAt!).getTime() >= now && r.status !== 'CANCELLED' && r.status !== 'NO_SHOW')
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
  const past = dated
    .filter((r) => !(new Date(r.scheduledAt!).getTime() >= now && r.status !== 'CANCELLED' && r.status !== 'NO_SHOW'))
    .sort((a, b) => new Date(b.scheduledAt!).getTime() - new Date(a.scheduledAt!).getTime());

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6 flex items-center gap-2">
        <CalendarClock size={20} className="text-[#1e3a5f]" />
        <h1 className="text-2xl font-bold text-[#1e3a5f]">My Meetings</h1>
      </div>

      {state === 'loading' && (
        <div className="flex items-center gap-2 py-16 text-[#4A4A4A]/60">
          <Loader2 size={18} className="animate-spin" /> Loading your meetings…
        </div>
      )}

      {state === 'error' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load your meetings just now. Please refresh.
        </div>
      )}

      {state === 'ready' && upcoming.length === 0 && past.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[#c9a961]/40 bg-[#faf8f3] py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#c9a961]/15">
            <CalendarClock size={26} className="text-[#b8941f]" />
          </div>
          <p className="text-lg font-bold text-[#1e3a5f]">No meetings yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[#4A4A4A]/60">
            They'll appear here once clients book a session with you.
          </p>
        </div>
      )}

      {state === 'ready' && (upcoming.length > 0 || past.length > 0) && (
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
    </div>
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

function MeetingCard({ b, muted }: { b: Row; muted?: boolean }) {
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
      </div>
    </div>
  );
}
