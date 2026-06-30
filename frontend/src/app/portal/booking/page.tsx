'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { CalendarClock, ArrowLeft, Check, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// Client portal — booking page.
//   type=free15 → the real native FREE_15 flow (date → slots → review →
//                 confirm), backed by /booking/slots + /booking/confirm.
//   type=gap|lia|unknown → the reassuring placeholder (paid flow lands in
//                 the next stage).

// ── Placeholder (gap / lia / unknown) ─────────────────────────────────
const HEADINGS: Record<string, string> = {
  gap: 'Your Gap-Closing session',
  lia: 'Your LIA Consultation',
};
const DEFAULT_HEADING = 'Book your consultation';

function BookingPlaceholder({ type }: { type: string }) {
  const heading = HEADINGS[type] ?? DEFAULT_HEADING;
  return (
    <section className="rounded-2xl bg-white border border-sorena-navy/10 p-8 md:p-12 text-center shadow-sm">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-sorena-gold/15">
        <CalendarClock size={26} className="text-sorena-navy" />
      </div>
      <h1 className="text-2xl md:text-3xl font-bold text-sorena-navy">{heading}</h1>
      <p className="mt-4 text-base leading-relaxed text-sorena-text/80">
        Booking is coming to your portal. Your case advisor has been notified
        and will be in touch to schedule this with you.
      </p>
      <div className="mt-10">
        <Link
          href="/portal/case"
          className="group inline-flex min-h-[3rem] items-center justify-center rounded-xl bg-sorena-gold px-8 py-3.5 text-sorena-navy font-semibold shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:bg-sorena-gold/90 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy focus-visible:ring-offset-2 focus-visible:ring-offset-sorena-cream"
        >
          Back to my case
        </Link>
      </div>
    </section>
  );
}

// ── FREE_15 flow ──────────────────────────────────────────────────────
// Capacity-aware: each time carries `remaining` seats (advisers free then)
// and stays available until remaining hits 0. The server assigns the
// adviser at confirm time, so the client sends only the start time.
interface Slot { startUtc: string; endUtc: string; remaining: number; availableAdviserIds: string[]; }
interface SlotsResponse { timezone: string; durationMinutes: number; slots: Slot[]; }

function fmt(iso: string, tz: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-NZ', { timeZone: tz, ...opts }).format(new Date(iso));
}
function dateKey(iso: string, tz: string): string {
  // YYYY-MM-DD in the adviser tz — sortable, groups slots by day.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

type Step = 'pick' | 'review' | 'done';

function FreeBookingFlow() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [data, setData] = useState<SlotsResponse | null>(null);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [step, setStep] = useState<Step>('pick');
  const [submitting, setSubmitting] = useState(false);
  const [takenError, setTakenError] = useState(false);
  const [freeUsed, setFreeUsed] = useState(false);

  async function loadSlots() {
    setLoading(true);
    setLoadError(false);
    try {
      // Free-once gate: if the client already used their free session,
      // show the "already used" panel instead of the slot picker.
      const elig = await api.get<{ used: boolean }>('/booking/free-eligibility');
      if (elig.used) { setFreeUsed(true); return; }

      const now = new Date();
      const to = new Date(now.getTime() + 14 * 86_400_000);
      const res = await api.get<SlotsResponse>(
        `/booking/slots?type=FREE_15&from=${encodeURIComponent(now.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      );
      setData(res);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSlots(); }, []);

  // Group slots by calendar date (in adviser tz).
  const days = useMemo(() => {
    if (!data) return [] as Array<{ key: string; label: string; slots: Slot[] }>;
    const tz = data.timezone;
    const map = new Map<string, { key: string; label: string; slots: Slot[] }>();
    for (const s of data.slots) {
      const key = dateKey(s.startUtc, tz);
      if (!map.has(key)) {
        map.set(key, { key, label: fmt(s.startUtc, tz, { weekday: 'short', day: 'numeric', month: 'short' }), slots: [] });
      }
      map.get(key)!.slots.push(s);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [data]);

  // Default the selected date to the first available day.
  useEffect(() => {
    if (!selectedDate && days.length > 0) setSelectedDate(days[0].key);
  }, [days, selectedDate]);

  const tz = data?.timezone ?? 'Pacific/Auckland';
  const activeDay = days.find((d) => d.key === selectedDate) ?? null;

  async function confirm() {
    if (!selectedSlot) return;
    setSubmitting(true);
    setTakenError(false);
    try {
      // Capacity model: the server assigns a free adviser for this time.
      await api.post('/booking/confirm', {
        type: 'FREE_15',
        slotStartUtc: selectedSlot.startUtc,
      });
      setStep('done');
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 403) {
        // Free-once rule tripped at confirm time (backstop) — show the
        // "already used" panel.
        setFreeUsed(true);
      } else if (err instanceof ApiError && err.statusCode === 409) {
        // Someone took it first — bounce back to slot selection and refresh.
        setTakenError(true);
        setSelectedSlot(null);
        setStep('pick');
        await loadSlots();
      } else {
        setTakenError(false);
        setStep('pick');
        setLoadError(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Loading / error / empty ─────────────────────────────────────────
  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-12 text-sorena-text/60">
          <Loader2 size={18} className="animate-spin" /> Finding available times…
        </div>
      </Shell>
    );
  }
  // ── Free session already used ───────────────────────────────────────
  if (freeUsed) {
    return (
      <Shell>
        <div className="text-center py-2">
          <h1 className="text-xl font-bold text-sorena-navy">Your free consultation is used</h1>
          <p className="mt-3 text-sm text-sorena-text/75">
            You&apos;ve already used your free consultation. Please choose a paid session to continue.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <Link
              href="/portal/booking?type=gap"
              className="inline-flex min-h-[3rem] items-center justify-center rounded-xl bg-sorena-gold px-8 py-3 font-semibold text-sorena-navy shadow-md transition-all hover:-translate-y-0.5 hover:bg-sorena-gold/90"
            >
              Explore paid sessions
            </Link>
            <BackToCase />
          </div>
        </div>
      </Shell>
    );
  }
  if (loadError) {
    return (
      <Shell>
        <p className="text-center text-sm text-sorena-text/70 py-8">
          We couldn&apos;t load available times. Please try again.
        </p>
        <div className="text-center">
          <button onClick={loadSlots} className="text-sm font-semibold text-sorena-navy underline">Try again</button>
        </div>
      </Shell>
    );
  }
  if (days.length === 0) {
    return (
      <Shell>
        <p className="text-center text-sm text-sorena-text/70 py-8">
          There are no open times right now. Please check back soon — your adviser is adding availability.
        </p>
        <BackToCase />
      </Shell>
    );
  }

  // ── Step: done ──────────────────────────────────────────────────────
  if (step === 'done' && selectedSlot) {
    return (
      <Shell>
        <div className="text-center py-4">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-sorena-jade/15">
            <Check size={26} className="text-sorena-jade" />
          </div>
          <h1 className="text-2xl font-bold text-sorena-navy">You&apos;re booked!</h1>
          <p className="mt-3 text-base text-sorena-text/80">
            {fmt(selectedSlot.startUtc, tz, { weekday: 'long', day: 'numeric', month: 'long' })}
            {' at '}
            {fmt(selectedSlot.startUtc, tz, { hour: 'numeric', minute: '2-digit', hour12: true })} NZ
          </p>
          <p className="mt-1 text-sm text-sorena-text/60">We&apos;ll see you then.</p>
          <div className="mt-8"><BackToCase /></div>
        </div>
      </Shell>
    );
  }

  // ── Step: review ────────────────────────────────────────────────────
  if (step === 'review' && selectedSlot) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-sorena-navy text-center">Review your booking</h1>
        <div className="mt-6 rounded-2xl bg-sorena-cream border border-sorena-navy/10 p-5 text-center">
          <p className="text-xs uppercase tracking-wide text-sorena-text/50 font-semibold">Free 15-minute consultation</p>
          <p className="mt-2 text-lg font-bold text-sorena-navy">
            {fmt(selectedSlot.startUtc, tz, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <p className="text-lg font-semibold text-sorena-navy">
            {fmt(selectedSlot.startUtc, tz, { hour: 'numeric', minute: '2-digit', hour12: true })} NZ
          </p>
          <p className="mt-2 text-xs text-sorena-text/50">Times shown in New Zealand time</p>
        </div>
        <div className="mt-6 space-y-3">
          <button
            onClick={confirm}
            disabled={submitting}
            className="flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-xl bg-sorena-gold px-6 py-3.5 font-semibold text-sorena-navy shadow-md transition-all hover:-translate-y-0.5 hover:bg-sorena-gold/90 hover:shadow-xl disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy"
          >
            {submitting ? <><Loader2 size={18} className="animate-spin" /> Confirming…</> : 'Confirm booking'}
          </button>
          <button
            onClick={() => { setStep('pick'); }}
            disabled={submitting}
            className="flex w-full items-center justify-center gap-1 text-sm font-semibold text-sorena-navy/70 hover:text-sorena-navy"
          >
            <ArrowLeft size={14} /> Back
          </button>
        </div>
      </Shell>
    );
  }

  // ── Step: pick (date row + that day's slots) ────────────────────────
  return (
    <Shell>
      <h1 className="text-xl font-bold text-sorena-navy text-center">Book your free 15-minute consultation</h1>
      <p className="mt-2 text-center text-sm text-sorena-text/60">Pick a day, then a time.</p>

      {takenError && (
        <div className="mt-4 rounded-xl bg-sorena-clay/10 border border-sorena-clay/30 px-4 py-3 text-sm text-sorena-clay text-center">
          That time was just taken — please pick another.
        </div>
      )}

      {/* Date row — horizontal scroll, mobile-first */}
      <div className="mt-6 -mx-1 flex gap-2 overflow-x-auto pb-2">
        {days.map((d) => {
          const active = d.key === selectedDate;
          return (
            <button
              key={d.key}
              onClick={() => setSelectedDate(d.key)}
              className={[
                'flex-shrink-0 rounded-xl border px-4 py-3 text-center transition-colors min-w-[5.5rem]',
                active
                  ? 'border-sorena-navy bg-sorena-navy text-white'
                  : 'border-sorena-navy/15 bg-white text-sorena-navy hover:border-sorena-navy/40',
              ].join(' ')}
            >
              <span className="block text-sm font-semibold">{d.label}</span>
              <span className={['block text-[11px]', active ? 'text-white/70' : 'text-sorena-text/50'].join(' ')}>
                {d.slots.length} time{d.slots.length === 1 ? '' : 's'}
              </span>
            </button>
          );
        })}
      </div>

      {/* Slots for the selected day */}
      <p className="mt-5 text-xs text-sorena-text/50 text-center">Times shown in New Zealand time</p>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {activeDay?.slots.map((s) => (
          <button
            key={s.startUtc}
            onClick={() => { setSelectedSlot(s); setStep('review'); }}
            className="flex flex-col items-center rounded-xl border border-sorena-navy/15 bg-white px-2 py-2.5 text-sm font-semibold text-sorena-navy transition-all hover:-translate-y-0.5 hover:border-sorena-gold hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sorena-gold"
          >
            {fmt(s.startUtc, tz, { hour: 'numeric', minute: '2-digit', hour12: true })}
            {/* Gentle urgency only when nearly full (last seat). */}
            {s.remaining === 1 && (
              <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-sorena-clay">1 left</span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-8"><BackToCase /></div>
    </Shell>
  );
}

// ── Shared chrome ─────────────────────────────────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl">
      <section className="rounded-2xl bg-white border border-sorena-navy/10 p-6 md:p-8 shadow-sm">{children}</section>
    </div>
  );
}
function BackToCase() {
  return (
    <div className="text-center">
      <Link href="/portal/case" className="text-sm font-semibold text-sorena-navy/70 underline underline-offset-4 hover:text-sorena-navy">
        Back to my case
      </Link>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
function BookingRouter() {
  const searchParams = useSearchParams();
  const type = (searchParams.get('type') ?? '').toLowerCase();
  if (type === 'free15') return <FreeBookingFlow />;
  return (
    <div className="mx-auto max-w-xl">
      <BookingPlaceholder type={type} />
    </div>
  );
}

export default function PortalBookingPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-xl text-center text-sm text-sorena-text/60">Loading…</div>}>
      <BookingRouter />
    </Suspense>
  );
}
