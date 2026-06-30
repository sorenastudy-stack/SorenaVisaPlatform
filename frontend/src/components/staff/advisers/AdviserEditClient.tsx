'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Plus, X, BadgeCheck, Clock } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import {
  LANGUAGES, SESSION_TYPES, TIMEZONES, WEEKDAYS,
  minutesToHHMM, hhmmToMinutes,
} from '@/lib/booking/adviser-options';

interface Window { id?: string; dayOfWeek: number; startMinute: number; endMinute: number; }
interface Adviser {
  id: string; name: string; email: string; role: string; liaVerified: boolean;
  languages: string[]; timezone: string; bookableSessionTypes: string[];
  bookingActive: boolean; windows: Window[];
}

export function AdviserEditClient({ adviserId }: { adviserId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Adviser | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    api.get<Adviser>(`/staff/advisers/${adviserId}`)
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
    return () => { cancelled = true; };
  }, [adviserId]);

  function toggle<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  async function saveProfile() {
    setSavingProfile(true); setMsg(null);
    try {
      const updated = await api.patch<Adviser>(`/staff/advisers/${adviserId}`, {
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
      const updated = await api.put<Adviser>(`/staff/advisers/${adviserId}/availability`, {
        windows: windows.map((w) => ({ dayOfWeek: w.dayOfWeek, startMinute: w.startMinute, endMinute: w.endMinute })),
      });
      setData(updated);
      setWindows(updated.windows.map((w) => ({ dayOfWeek: w.dayOfWeek, startMinute: w.startMinute, endMinute: w.endMinute })));
      setMsg({ kind: 'ok', text: 'Weekly hours saved.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Could not save hours.' });
    } finally { setSavingHours(false); }
  }

  if (loadError) {
    return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-red-600">Adviser not found or failed to load. <Link href="/staff/advisers" className="underline">Back</Link></div>;
  }
  if (!data) {
    return <div className="mx-auto max-w-3xl px-4 py-12 flex items-center gap-2 text-sorena-text/60"><Loader2 size={18} className="animate-spin" /> Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <Link href="/staff/advisers" className="inline-flex items-center gap-1 text-sm text-sorena-text/60 hover:text-sorena-navy mb-4"><ArrowLeft size={14} /> Advisers</Link>

      <div className="mb-6 flex items-center gap-2">
        <h1 className="text-2xl font-bold text-sorena-navy">{data.name}</h1>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">{data.role}</span>
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

      {/* ── Stage B placeholder ─────────────────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-gray-50/60 p-5 text-center">
        <p className="text-sm font-semibold text-sorena-text/50">Leave / time off — coming soon</p>
        <p className="mt-1 text-xs text-sorena-text/40">One-off days off and custom hours will appear here.</p>
      </section>
    </div>
  );
}
