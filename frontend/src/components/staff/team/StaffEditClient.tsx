'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { StaffAvatar } from '@/components/staff/StaffAvatar';
import { ArrowLeft, Loader2, Plus, X, BadgeCheck, Clock, CalendarOff, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useRoleLabel } from '@/lib/role-label';
import { formatDate } from '@/lib/date';
import { DateInput } from '@/components/ui/DateInput';
import {
  LANGUAGES, SESSION_TYPES, TIMEZONES, WEEKDAYS,
  minutesToHHMM, hhmmToMinutes,
} from '@/lib/booking/staff-options';

interface Window { id?: string; dayOfWeek: number; startMinute: number; endMinute: number; }
interface Staff {
  id: string; name: string; email: string; role: string; liaVerified: boolean; photoUrl: string | null;
  languages: string[]; timezone: string; bookableSessionTypes: string[];
  bookingActive: boolean; windows: Window[];
}

interface Leave {
  id: string; startDate: string; endDate: string; kind: string; status: string;
  reason: string | null;
}
interface Conflict {
  id: string; type: string; scheduledAt: string; timezone: string | null;
  clientName: string; clientEmail: string | null;
}

const LEAVE_STATUS_STYLE: Record<string, string> = {
  REQUESTED: 'bg-sorena-gold/15 text-sorena-navy border border-sorena-gold/40',
  APPROVED: 'bg-sorena-jade/10 text-sorena-jade border border-sorena-jade/30',
  REJECTED: 'bg-gray-100 text-gray-500 border border-gray-200',
  CANCELLED: 'bg-gray-100 text-gray-500 border border-gray-200',
};

// Day-first, unambiguous display (e.g. "8 Jul 2026") — never US mm/dd/yyyy.
// The underlying value stays YYYY-MM-DD (what the backend expects).
const fmtDay = (ymd: string): string => formatDate(ymd);
function fmtDateRange(start: string, end: string): string {
  return start === end ? fmtDay(start) : `${fmtDay(start)} – ${fmtDay(end)}`;
}

// Leave is scheduled around now — allow the current year through a few ahead.
const LEAVE_MIN_YEAR = new Date().getFullYear();
const LEAVE_MAX_YEAR = new Date().getFullYear() + 2;
function fmtConflictWhen(iso: string, tz: string | null): string {
  const zone = tz ?? 'Pacific/Auckland';
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: zone, weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

export function StaffEditClient({ staffId }: { staffId: string }) {
  const router = useRouter();
  const roleLabel = useRoleLabel();
  const [data, setData] = useState<Staff | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Section A (profile) draft
  const [languages, setLanguages] = useState<string[]>([]);
  const [timezone, setTimezone] = useState('Pacific/Auckland');
  const [types, setTypes] = useState<string[]>([]);
  const [bookingActive, setBookingActive] = useState(true);

  // Section B (weekly windows) draft — keyed by weekday
  const [windows, setWindows] = useState<Window[]>([]);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Section C (leave / time-off) state
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [leaveStart, setLeaveStart] = useState('');
  const [leaveEnd, setLeaveEnd] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [addingLeave, setAddingLeave] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [leaveMsg, setLeaveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<Staff>(`/staff/team/${staffId}`)
      .then((a) => {
        if (cancelled) return;
        setData(a);
        setLanguages(a.languages);
        setTimezone(a.timezone);
        setTypes(a.bookableSessionTypes);
        setBookingActive(a.bookingActive);
        setWindows(a.windows.map((w) => ({ dayOfWeek: w.dayOfWeek, startMinute: w.startMinute, endMinute: w.endMinute })));
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    api.get<Leave[]>(`/staff/team/${staffId}/leave`)
      .then((rows) => { if (!cancelled) setLeaves(rows); })
      .catch(() => { /* leave list is non-fatal; section just shows empty */ });
    return () => { cancelled = true; };
  }, [staffId]);

  function toggle<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  async function saveProfile() {
    setSavingProfile(true); setMsg(null);
    try {
      const updated = await api.patch<Staff>(`/staff/team/${staffId}`, {
        languages, timezone, bookableSessionTypes: types, bookingActive,
      });
      setData(updated);
      setMsg({ kind: 'ok', text: 'Profile saved.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Could not save profile.' });
    } finally { setSavingProfile(false); }
  }

  // ── weekly hours editing ────────────────────────────────────────────
  function addWindow(dow: number) {
    setWindows((w) => [...w, { dayOfWeek: dow, startMinute: 540, endMinute: 720 }]);
  }
  function removeWindow(idx: number) {
    setWindows((w) => w.filter((_, i) => i !== idx));
  }
  function setWindowTime(idx: number, field: 'startMinute' | 'endMinute', hhmm: string) {
    setWindows((w) => w.map((x, i) => (i === idx ? { ...x, [field]: hhmmToMinutes(hhmm) } : x)));
  }

  function validateHours(): string | null {
    for (const w of windows) {
      if (w.startMinute >= w.endMinute) return 'Each window must start before it ends.';
    }
    for (const { dow } of WEEKDAYS) {
      const day = windows.filter((w) => w.dayOfWeek === dow).sort((a, b) => a.startMinute - b.startMinute);
      for (let i = 1; i < day.length; i++) {
        if (day[i].startMinute < day[i - 1].endMinute) return 'Windows on the same day cannot overlap.';
      }
    }
    return null;
  }

  async function saveHours() {
    const err = validateHours();
    if (err) { setMsg({ kind: 'err', text: err }); return; }
    setSavingHours(true); setMsg(null);
    try {
      const updated = await api.put<Staff>(`/staff/team/${staffId}/availability`, {
        windows: windows.map((w) => ({ dayOfWeek: w.dayOfWeek, startMinute: w.startMinute, endMinute: w.endMinute })),
      });
      setData(updated);
      setWindows(updated.windows.map((w) => ({ dayOfWeek: w.dayOfWeek, startMinute: w.startMinute, endMinute: w.endMinute })));
      setMsg({ kind: 'ok', text: 'Weekly hours saved.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Could not save hours.' });
    } finally { setSavingHours(false); }
  }

  // ── leave / time-off ────────────────────────────────────────────────
  async function addLeave() {
    setLeaveMsg(null); setConflicts(null);
    if (!leaveStart || !leaveEnd) { setLeaveMsg({ kind: 'err', text: 'Pick a start and end date.' }); return; }
    if (leaveEnd < leaveStart) { setLeaveMsg({ kind: 'err', text: 'End date must be on or after start date.' }); return; }
    setAddingLeave(true);
    try {
      const res = await api.post<{ leave: Leave; conflicts: Conflict[] }>(
        `/staff/team/${staffId}/leave`,
        { startDate: leaveStart, endDate: leaveEnd, reason: leaveReason || undefined },
      );
      setLeaves((prev) => [res.leave, ...prev]);
      setLeaveStart(''); setLeaveEnd(''); setLeaveReason('');
      if (res.conflicts.length > 0) {
        setConflicts(res.conflicts);
        setLeaveMsg(null);
      } else {
        setLeaveMsg({ kind: 'ok', text: 'Time off added. This staff member is now off on those days.' });
      }
    } catch (e) {
      setLeaveMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Could not add time off.' });
    } finally { setAddingLeave(false); }
  }

  async function deleteLeave(id: string) {
    setLeaveMsg(null);
    try {
      await api.delete(`/staff/team/${staffId}/leave/${id}`);
      setLeaves((prev) => prev.filter((l) => l.id !== id));
      setLeaveMsg({ kind: 'ok', text: 'Time off removed. Those days are available again.' });
    } catch (e) {
      setLeaveMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Could not remove time off.' });
    }
  }

  // Approve/reject a PENDING (REQUESTED) request. Approve keeps the days
  // blocked (now permanent) and surfaces any overlapping confirmed bookings;
  // reject reopens the days. Existing confirmed bookings are never touched.
  async function decideLeave(id: string, status: 'APPROVED' | 'REJECTED') {
    setLeaveMsg(null); setConflicts(null);
    try {
      const res = await api.patch<{ leave: Leave; conflicts: Conflict[] }>(
        `/staff/team/${staffId}/leave/${id}`, { status },
      );
      setLeaves((prev) => prev.map((l) => (l.id === id ? res.leave : l)));
      if (status === 'APPROVED' && res.conflicts.length > 0) {
        setConflicts(res.conflicts);
      } else {
        setLeaveMsg({
          kind: 'ok',
          text: status === 'APPROVED'
            ? 'Request approved. Those days stay blocked for booking.'
            : 'Request rejected. Those days are available again.',
        });
      }
    } catch (e) {
      setLeaveMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Could not update the request.' });
    }
  }

  if (loadError) {
    return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-red-600">Staff member not found or failed to load. <Link href="/staff/team" className="underline">Back</Link></div>;
  }
  if (!data) {
    return <div className="mx-auto max-w-3xl px-4 py-12 flex items-center gap-2 text-sorena-text/60"><Loader2 size={18} className="animate-spin" /> Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <Link href="/staff/team" className="inline-flex items-center gap-1 text-sm text-sorena-text/60 hover:text-sorena-navy mb-4"><ArrowLeft size={14} /> Staff</Link>

      <div className="mb-6 flex items-center gap-2">
        <StaffAvatar name={data.name} photoUrl={data.photoUrl} size={40} />
        <h1 className="text-2xl font-bold text-sorena-navy">{data.name}</h1>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">{roleLabel(data.role)}</span>
        {data.role === 'LIA' && data.liaVerified && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sorena-jade"><BadgeCheck size={13} /> verified</span>
        )}
      </div>

      {msg && (
        <div className={`mb-5 rounded-xl px-4 py-3 text-sm ${msg.kind === 'ok' ? 'bg-sorena-jade/10 text-sorena-jade border border-sorena-jade/30' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.text}</div>
      )}

      {/* ── Section A — Booking profile ─────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-sorena-text/60">Booking profile</h2>

        <div className="mt-4">
          <label className="block text-sm font-semibold text-sorena-navy mb-2">Languages</label>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => setLanguages((v) => toggle(v, l.code))}
                className={`rounded-full px-3 py-1.5 text-sm border transition-colors ${languages.includes(l.code) ? 'bg-sorena-navy text-white border-sorena-navy' : 'bg-white text-sorena-navy border-gray-200 hover:border-sorena-navy/40'}`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-sorena-navy mb-2">Timezone</label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sorena-navy/30">
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-sorena-navy">
              <input type="checkbox" checked={bookingActive} onChange={(e) => setBookingActive(e.target.checked)} className="h-4 w-4 rounded" />
              Active for booking
            </label>
          </div>
        </div>

        <div className="mt-5">
          <label className="block text-sm font-semibold text-sorena-navy mb-2">Session types handled</label>
          <div className="space-y-2">
            {SESSION_TYPES.map((s) => {
              const liaBlocked = s.requiresLia && !(data.role === 'LIA' && data.liaVerified);
              return (
                <label key={s.value} className={`flex items-center gap-2 text-sm ${liaBlocked ? 'text-gray-400' : 'text-sorena-navy'}`}>
                  <input
                    type="checkbox"
                    disabled={liaBlocked}
                    checked={types.includes(s.value)}
                    onChange={() => setTypes((v) => toggle(v, s.value))}
                    className="h-4 w-4 rounded"
                  />
                  {s.label}
                  {liaBlocked && <span className="text-[11px] text-gray-400">(requires a verified LIA)</span>}
                </label>
              );
            })}
          </div>
        </div>

        <div className="mt-6">
          <button onClick={saveProfile} disabled={savingProfile} className="inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-xl bg-sorena-gold px-6 py-2.5 font-semibold text-sorena-navy shadow-sm transition-all hover:bg-sorena-gold/90 disabled:opacity-60">
            {savingProfile ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : 'Save profile'}
          </button>
        </div>
      </section>

      {/* ── Section B — Weekly hours ────────────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-sorena-text/60">Weekly hours</h2>
          <span className="inline-flex items-center gap-1 text-xs text-sorena-text/50"><Clock size={13} /> Times shown in {timezone}</span>
        </div>

        <div className="mt-4 space-y-3">
          {WEEKDAYS.map(({ dow, label }) => {
            const dayWindows = windows.map((w, i) => ({ w, i })).filter(({ w }) => w.dayOfWeek === dow);
            return (
              <div key={dow} className="rounded-xl border border-gray-100 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-sorena-navy">{label}</span>
                  <button type="button" onClick={() => addWindow(dow)} className="inline-flex items-center gap-1 text-xs font-semibold text-sorena-navy hover:text-sorena-gold">
                    <Plus size={14} /> Add time window
                  </button>
                </div>
                {dayWindows.length === 0 && <p className="mt-2 text-xs text-sorena-text/40">No hours</p>}
                <div className="mt-2 space-y-2">
                  {dayWindows.map(({ w, i }) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="time" value={minutesToHHMM(w.startMinute)} onChange={(e) => setWindowTime(i, 'startMinute', e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                      <span className="text-gray-400">–</span>
                      <input type="time" value={minutesToHHMM(w.endMinute)} onChange={(e) => setWindowTime(i, 'endMinute', e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                      <button type="button" onClick={() => removeWindow(i)} className="ml-1 text-gray-400 hover:text-red-500"><X size={16} /></button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6">
          <button onClick={saveHours} disabled={savingHours} className="inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-xl bg-sorena-gold px-6 py-2.5 font-semibold text-sorena-navy shadow-sm transition-all hover:bg-sorena-gold/90 disabled:opacity-60">
            {savingHours ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : 'Save weekly hours'}
          </button>
        </div>
      </section>

      {/* ── Section C — Leave / time off ────────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-sorena-text/60">Leave / time off</h2>
          <span className="inline-flex items-center gap-1 text-xs text-sorena-text/50"><CalendarOff size={13} /> Full days, in {timezone}</span>
        </div>
        <p className="mt-2 text-xs text-sorena-text/50">
          Approved time off removes those whole days from booking availability. Existing confirmed sessions are never cancelled — they’re flagged below so you can rebook or notify the client.
        </p>

        {leaveMsg && (
          <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${leaveMsg.kind === 'ok' ? 'bg-sorena-jade/10 text-sorena-jade border border-sorena-jade/30' : 'bg-red-50 text-red-700 border border-red-200'}`}>{leaveMsg.text}</div>
        )}

        {/* Conflict warning banner (shown right after adding leave) */}
        {conflicts && conflicts.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
              <AlertTriangle size={16} />
              {conflicts.length} confirmed {conflicts.length === 1 ? 'booking falls' : 'bookings fall'} within this leave — rebook or notify {conflicts.length === 1 ? 'this client' : 'these clients'}
            </div>
            <ul className="mt-2 space-y-1">
              {conflicts.map((c) => (
                <li key={c.id} className="text-xs text-amber-900">
                  <span className="font-semibold">{c.clientName}</span>
                  {' · '}{c.type}
                  {' · '}{fmtConflictWhen(c.scheduledAt, c.timezone)}
                  {c.clientEmail && <span className="text-amber-700"> · {c.clientEmail}</span>}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-amber-700">The leave was saved and these days are now off. The bookings above are unchanged (still confirmed).</p>
          </div>
        )}

        {/* Add time off */}
        <div className="mt-4 rounded-xl border border-gray-100 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-sorena-navy mb-1">From <span className="font-normal text-sorena-text/40">(dd/mm/yyyy)</span></label>
              <DateInput value={leaveStart || null} onChange={(iso) => setLeaveStart(iso ?? '')} minYear={LEAVE_MIN_YEAR} maxYear={LEAVE_MAX_YEAR} />
              {leaveStart && <p className="mt-1 text-[11px] text-sorena-text/50">{fmtDay(leaveStart)}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-sorena-navy mb-1">To <span className="font-normal text-sorena-text/40">(dd/mm/yyyy)</span></label>
              <DateInput value={leaveEnd || null} onChange={(iso) => setLeaveEnd(iso ?? '')} minYear={LEAVE_MIN_YEAR} maxYear={LEAVE_MAX_YEAR} />
              {leaveEnd && <p className="mt-1 text-[11px] text-sorena-text/50">{fmtDay(leaveEnd)}</p>}
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-xs font-semibold text-sorena-navy mb-1">Reason (optional)</label>
            <input type="text" value={leaveReason} maxLength={500} placeholder="e.g. Annual leave" onChange={(e) => setLeaveReason(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
          </div>
          <div className="mt-3">
            <button onClick={addLeave} disabled={addingLeave} className="inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-xl bg-sorena-gold px-5 py-2 text-sm font-semibold text-sorena-navy shadow-sm transition-all hover:bg-sorena-gold/90 disabled:opacity-60">
              {addingLeave ? <><Loader2 size={15} className="animate-spin" /> Adding…</> : <><Plus size={15} /> Add time off</>}
            </button>
          </div>
        </div>

        {/* Existing leave list */}
        <div className="mt-4 space-y-2">
          {leaves.length === 0 ? (
            <p className="text-xs text-sorena-text/40">No time off scheduled.</p>
          ) : (
            leaves.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-sorena-navy">{fmtDateRange(l.startDate, l.endDate)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${LEAVE_STATUS_STYLE[l.status] ?? 'bg-gray-100 text-gray-500'}`}>{l.status}</span>
                  </div>
                  {l.reason && <p className="mt-0.5 truncate text-xs text-sorena-text/50">{l.reason}</p>}
                </div>
                {l.status === 'REQUESTED' ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button type="button" onClick={() => decideLeave(l.id, 'APPROVED')} className="rounded-lg bg-sorena-jade/10 px-2.5 py-1 text-xs font-semibold text-sorena-jade border border-sorena-jade/30 hover:bg-sorena-jade/20">Approve</button>
                    <button type="button" onClick={() => decideLeave(l.id, 'REJECTED')} className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-100">Reject</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => deleteLeave(l.id)} className="shrink-0 text-gray-400 hover:text-red-500" aria-label="Remove time off"><X size={16} /></button>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
