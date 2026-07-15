'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Calendar, Scale, Sparkles, ArrowLeft, ArrowRight, Check, Loader2, Lock } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import {
  getBookingEligibility,
  type BookingEligibility,
  type BookingType,
  type TypeEligibility,
} from '@/lib/booking/eligibility';

// Client portal — booking page.
//   type=free15  → native FREE_15 flow (date → slots → review → confirm),
//                  backed by /booking/slots + /booking/confirm.
//   type=gap     → PaidBookingFlow(GAP_CLOSING): hold → checkout (Stripe) or
//                  pay-with-wallet. Real, money-safe.
//   type=lia     → PaidBookingFlow(LIA): same paid flow (NZD 150).
//   type=unknown → the reassuring placeholder (advisor will be in touch).

// ── Chooser (bare /portal/booking) — shows ALL THREE session types, always ────
// Display-only. Eligibility is ENFORCED server-side (assertEligible at
// createFreeBooking / createHold), so a dimmed button forced in devtools still
// gets a 403. Ineligible types render genuinely disabled + the binding reason.

const CHOOSER_ORDER: BookingType[] = ['FREE_15', 'GAP_CLOSING', 'LIA'];
const TYPE_META: Record<BookingType, { slug: string; title: string; blurb: string; icon: React.ReactNode }> = {
  FREE_15:     { slug: 'free15', title: 'Free 15-minute consultation', blurb: 'Confirm your pathway and next steps with our team.', icon: <Calendar size={20} /> },
  GAP_CLOSING: { slug: 'gap',    title: 'Gap-Closing Session',         blurb: 'A structured improvement plan with an Admission Specialist.', icon: <Sparkles size={20} /> },
  LIA:         { slug: 'lia',    title: 'LIA Consultation',            blurb: 'Tailored legal guidance from a Licensed Immigration Adviser.', icon: <Scale size={20} /> },
};

function BookingChooser() {
  const [elig, setElig] = useState<BookingEligibility | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getBookingEligibility()
      .then((e) => { if (!cancelled) setElig(e); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 text-center">
        <h1 className="text-2xl md:text-3xl font-bold text-sorena-navy">Book a consultation</h1>
        <p className="mt-2 text-sm text-sorena-text/70">Choose the session that fits where you are.</p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-sorena-clay/30 bg-sorena-clay/10 px-4 py-3 text-sm text-sorena-clay text-center">
          Couldn’t load your booking options. Please refresh.
        </div>
      )}

      {!elig && !error && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-sorena-text/60">
          <Loader2 size={18} className="animate-spin" /> Loading your options…
        </div>
      )}

      {elig && (
        <>
          {/* No submission → nudge to the assessment. The three types below are
              still shown (dimmed) with the server "take your assessment" reason. */}
          {!elig.hasSubmission && (
            <div className="mb-5 rounded-2xl border border-sorena-gold/40 bg-sorena-gold/10 p-4 text-center">
              <p className="text-sm font-semibold text-sorena-navy">Take your free assessment first</p>
              <p className="mt-1 text-xs text-sorena-text/70">A short assessment unlocks the right consultation for you.</p>
              <Link
                href="/scorecard"
                className="mt-3 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-sorena-navy px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-sorena-navy/90"
              >
                Start my assessment
              </Link>
            </div>
          )}

          <div className="space-y-4">
            {CHOOSER_ORDER.map((t) => {
              const item = elig.types.find((x) => x.type === t);
              return item ? <BookingTypeCard key={t} item={item} meta={TYPE_META[t]} /> : null;
            })}
          </div>

          <div className="mt-8"><BackToCase /></div>
        </>
      )}
    </div>
  );
}

function BookingTypeCard({
  item, meta,
}: { item: TypeEligibility; meta: { slug: string; title: string; blurb: string; icon: React.ReactNode } }) {
  const priceLabel = item.paid ? `NZD ${item.priceNzd}` : 'Free';
  return (
    <section className="rounded-xl border border-sorena-navy/10 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={['flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl', item.eligible ? 'bg-sorena-gold/15 text-sorena-navy' : 'bg-sorena-navy/[0.04] text-sorena-navy/40'].join(' ')}>
          {meta.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className={['text-base font-bold', item.eligible ? 'text-sorena-navy' : 'text-sorena-navy/50'].join(' ')}>{meta.title}</h2>
            <span className={['flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold', item.paid ? 'bg-sorena-navy/5 text-sorena-navy' : 'bg-sorena-jade/15 text-sorena-jade', item.eligible ? '' : 'opacity-60'].join(' ')}>{priceLabel}</span>
          </div>
          <p className={['mt-1 text-sm', item.eligible ? 'text-sorena-text/70' : 'text-sorena-text/40'].join(' ')}>{meta.blurb}</p>
        </div>
      </div>

      <div className="mt-4">
        {item.eligible ? (
          <Link
            href={`/portal/booking?type=${meta.slug}`}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-sorena-gold px-6 py-3 text-sm font-bold text-sorena-navy shadow-sm transition-all hover:-translate-y-0.5 hover:bg-sorena-gold/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy"
          >
            {item.paid ? `Book · ${priceLabel}` : 'Book now'} <ArrowRight size={16} />
          </Link>
        ) : (
          <>
            <button
              type="button"
              disabled
              className="inline-flex min-h-[48px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-sorena-navy/5 px-6 py-3 text-sm font-bold text-sorena-navy/40"
            >
              <Lock size={15} /> Not available yet
            </button>
            <p className="mt-2 text-xs italic leading-relaxed text-sorena-text/60">{item.reason}</p>
          </>
        )}
      </div>
    </section>
  );
}

// ── FREE_15 flow ──────────────────────────────────────────────────────
// Capacity-aware: each time carries `remaining` seats (advisers free then)
// and stays available until remaining hits 0. The server assigns the
// adviser at confirm time, so the client sends only the start time.
interface Slot { startUtc: string; endUtc: string; remaining: number; availableStaffIds: string[]; }
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
  // (No zero-slots early-return — the calendar always renders; the "pick" step
  // below shows the empty scaffold when days.length === 0.)

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

      {days.length === 0 ? (
        <EmptyCalendarScaffold />
      ) : (
        <>
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
        </>
      )}

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

// Empty-availability calendar scaffold — the day-row + time-grid still render as
// a greyed, non-interactive shell (never hidden), with a quiet explanatory line.
function EmptyCalendarScaffold() {
  return (
    <>
      <div className="mt-6 -mx-1 flex gap-2 overflow-x-auto pb-2" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex-shrink-0 rounded-xl border border-sorena-navy/10 bg-sorena-navy/[0.03] px-4 py-3 min-w-[5.5rem]">
            <span className="block h-3.5 w-10 rounded bg-sorena-navy/10" />
            <span className="mt-1.5 block h-2.5 w-8 rounded bg-sorena-navy/10" />
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs text-sorena-text/50 text-center">Times shown in New Zealand time</p>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4" aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[42px] rounded-xl border border-sorena-navy/10 bg-sorena-navy/[0.03]" />
        ))}
      </div>
      <p className="mt-4 text-center text-sm text-sorena-text/60">
        No open times in this period. Please check back soon — your adviser is adding availability.
      </p>
    </>
  );
}

// ── Paid flow (PR-BOOKING-4): GAP_CLOSING (slice 1) + LIA (slice 2) ────
interface Hold {
  consultationId: string; holdExpiresAt: string; amountNZD: number;
  type: string; slotStartUtc: string; staffName: string; timezone: string;
}
type GapStep = 'pick' | 'hold' | 'expired' | 'done';

// Display strings only — the authoritative price/duration live in the
// backend session-config; the hold response carries the real amount.
const PAID_CONFIG: Record<'GAP_CLOSING' | 'LIA', { label: string; price: number }> = {
  GAP_CLOSING: { label: 'Gap-Closing session', price: 30 },
  LIA:         { label: 'LIA Consultation (45 min)', price: 150 },
};

function PaidBookingFlow({ sessionType }: { sessionType: 'GAP_CLOSING' | 'LIA' }) {
  const cfg = PAID_CONFIG[sessionType];
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [data, setData] = useState<SlotsResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [step, setStep] = useState<GapStep>('pick');
  const [hold, setHold] = useState<Hold | null>(null);
  const [holding, setHolding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  // PR-WALLET slice 1 — must accept the cancellation/refund policy before pay.
  const [accepted, setAccepted] = useState(false);
  // PR-WALLET slice 3 — wallet balance (cents) for the "pay with credit" option.
  const [walletCents, setWalletCents] = useState<number | null>(null);
  const [payingWallet, setPayingWallet] = useState(false);
  const [doneBalanceCents, setDoneBalanceCents] = useState<number | null>(null);

  async function loadSlots() {
    setLoading(true); setLoadError(false);
    try {
      const now = new Date();
      const to = new Date(now.getTime() + 14 * 86_400_000);
      const res = await api.get<SlotsResponse>(
        `/booking/slots?type=${sessionType}&from=${encodeURIComponent(now.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      );
      setData(res);
    } catch { setLoadError(true); } finally { setLoading(false); }
  }
  useEffect(() => { loadSlots(); }, []);

  // Wallet balance for the "pay with credit" option. Non-fatal — if it fails
  // the client just sees the card button (no wallet option shown).
  useEffect(() => {
    api.get<{ balanceCents: number }>('/wallet')
      .then((w) => setWalletCents(w.balanceCents))
      .catch(() => setWalletCents(null));
  }, []);

  const days = useMemo(() => {
    if (!data) return [] as Array<{ key: string; label: string; slots: Slot[] }>;
    const tz = data.timezone;
    const map = new Map<string, { key: string; label: string; slots: Slot[] }>();
    for (const s of data.slots) {
      const key = dateKey(s.startUtc, tz);
      if (!map.has(key)) map.set(key, { key, label: fmt(s.startUtc, tz, { weekday: 'short', day: 'numeric', month: 'short' }), slots: [] });
      map.get(key)!.slots.push(s);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [data]);
  useEffect(() => { if (!selectedDate && days.length > 0) setSelectedDate(days[0].key); }, [days, selectedDate]);

  const tz = data?.timezone ?? 'Pacific/Auckland';
  const activeDay = days.find((d) => d.key === selectedDate) ?? null;

  // Countdown while holding.
  useEffect(() => {
    if (step !== 'hold' || !hold) return;
    const tick = () => {
      const s = Math.max(0, Math.round((new Date(hold.holdExpiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(s);
      if (s <= 0) setStep('expired');
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [step, hold]);

  async function startHold(slot: Slot) {
    setHolding(true); setPickError(null);
    try {
      const h = await api.post<Hold>('/booking/hold', { type: sessionType, slotStartUtc: slot.startUtc });
      setHold(h); setStep('hold');
    } catch (err) {
      // Slot gone / no adviser free — refresh and let them pick again.
      setPickError('That time is no longer available — please pick another.');
      await loadSlots();
    } finally { setHolding(false); }
  }

  async function pay() {
    if (!hold || !accepted) return;
    setPaying(true);
    try {
      const { url } = await api.post<{ url: string }>('/booking/checkout', { consultationId: hold.consultationId, accepted: true });
      window.location.href = url; // hand off to Stripe Checkout
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) { setStep('expired'); }
      else { setStep('expired'); }
    } finally { setPaying(false); }
  }

  // PR-WALLET slice 3 — pay the full price from wallet credit (no Stripe).
  // Same policy-acceptance gate as card. On success we land on the in-app
  // "done" screen; on 409 (hold gone / slot lost / already paid) → expired.
  async function payWithWallet() {
    if (!hold || !accepted) return;
    setPayingWallet(true);
    try {
      const res = await api.post<{ status: string; newBalanceCents: number }>(
        '/booking/pay-with-wallet', { consultationId: hold.consultationId, accepted: true },
      );
      setDoneBalanceCents(res.newBalanceCents);
      setStep('done');
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 400) {
        // Balance no longer covers it (spent elsewhere) — hide the wallet
        // option and let them pay by card instead. Stay on the hold screen.
        setWalletCents(null);
      } else {
        setStep('expired');
      }
    } finally { setPayingWallet(false); }
  }

  function resetToPick() { setHold(null); setStep('pick'); loadSlots(); }

  if (loading) {
    return <Shell><div className="flex items-center justify-center gap-2 py-12 text-sorena-text/60"><Loader2 size={18} className="animate-spin" /> Finding available times…</div></Shell>;
  }
  if (loadError) {
    return <Shell><p className="text-center text-sm text-sorena-text/70 py-8">We couldn&apos;t load available times. Please try again.</p><div className="text-center"><button onClick={loadSlots} className="text-sm font-semibold text-sorena-navy underline">Try again</button></div></Shell>;
  }

  // ── Hold expired ────────────────────────────────────────────────────
  if (step === 'expired') {
    return (
      <Shell>
        <div className="text-center py-2">
          <h1 className="text-xl font-bold text-sorena-navy">Your hold expired</h1>
          <p className="mt-3 text-sm text-sorena-text/75">No charge was made. Please pick a time again.</p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <button onClick={resetToPick} className="inline-flex min-h-[3rem] items-center justify-center rounded-xl bg-sorena-gold px-8 py-3 font-semibold text-sorena-navy shadow-md hover:bg-sorena-gold/90">Pick a time</button>
            <BackToCase />
          </div>
        </div>
      </Shell>
    );
  }

  // ── Done (wallet-paid; card path redirects to Stripe instead) ───────
  if (step === 'done') {
    return (
      <Shell>
        <div className="text-center py-4">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-sorena-jade/15">
            <Check size={26} className="text-sorena-jade" />
          </div>
          <h1 className="text-2xl font-bold text-sorena-navy">You&apos;re booked!</h1>
          <p className="mt-3 text-base text-sorena-text/80">
            Paid with your Sorena wallet credit.
            {doneBalanceCents != null && ` New balance: NZD ${(doneBalanceCents / 100).toFixed(2)}.`}
          </p>
          <p className="mt-1 text-sm text-sorena-text/60">We&apos;ll email your confirmation and meeting link.</p>
          <div className="mt-8"><BackToCase /></div>
        </div>
      </Shell>
    );
  }

  // ── Hold: 15-min countdown + pay ────────────────────────────────────
  if (step === 'hold' && hold) {
    const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
    const ss = String(secondsLeft % 60).padStart(2, '0');
    return (
      <Shell>
        <h1 className="text-xl font-bold text-sorena-navy text-center">Confirm &amp; pay</h1>
        <div className="mt-6 rounded-2xl bg-sorena-cream border border-sorena-navy/10 p-5 text-center">
          <p className="text-xs uppercase tracking-wide text-sorena-text/50 font-semibold">{cfg.label} · NZD {hold.amountNZD}</p>
          <p className="mt-2 text-lg font-bold text-sorena-navy">{fmt(hold.slotStartUtc, tz, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <p className="text-lg font-semibold text-sorena-navy">{fmt(hold.slotStartUtc, tz, { hour: 'numeric', minute: '2-digit', hour12: true })} NZ</p>
          <p className="mt-1 text-xs text-sorena-text/50">with {hold.staffName} · Times in New Zealand time</p>
        </div>
        <div className="mt-5 text-center">
          <p className="text-sm text-sorena-text/70">We&apos;re holding this time for you.</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-sorena-navy">{mm}:{ss}</p>
          <p className="text-xs text-sorena-text/50">minutes left to pay</p>
        </div>
        {/* Cancellation & refund policy — must be accepted before paying. */}
        <div className="mt-6 rounded-xl border border-sorena-navy/10 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-sorena-text/50">Cancellation &amp; refund policy</p>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-sorena-text/70">
            <li>• Cancel more than 24 hours before: 100% to your Sorena wallet.</li>
            <li>• Cancel within 24 hours: 20% retained, 80% to your wallet.</li>
            <li>• No-show: 25% retained, 75% to your wallet.</li>
            <li>• Wallet credit never expires and is usable across Sorena services; it isn’t cash-refundable (except where legally required) or transferable.</li>
          </ul>
          <label className="mt-3 flex items-start gap-2 text-sm text-sorena-navy">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-4 w-4 rounded" />
            <span>I have read and accept the cancellation &amp; refund policy.</span>
          </label>
        </div>

        <div className="mt-6 space-y-3">
          {/* PR-WALLET slice 3 — wallet-covers-full option, shown alongside
              card when the balance covers the price. Full amount only. */}
          {walletCents != null && walletCents >= Math.round(hold.amountNZD * 100) && (
            <>
              <button onClick={payWithWallet} disabled={payingWallet || paying || !accepted} className="flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-xl bg-sorena-navy px-6 py-3.5 font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-sorena-navy/90 disabled:opacity-60 disabled:hover:translate-y-0">
                {payingWallet ? <><Loader2 size={18} className="animate-spin" /> Paying…</> : `Pay with wallet credit (NZD ${hold.amountNZD})`}
              </button>
              <p className="text-center text-xs text-sorena-text/50">
                Wallet balance NZD {(walletCents / 100).toFixed(2)} · after this booking NZD {((walletCents - Math.round(hold.amountNZD * 100)) / 100).toFixed(2)}
              </p>
              <div className="flex items-center gap-3 py-1 text-xs text-sorena-text/40">
                <span className="h-px flex-1 bg-sorena-navy/10" /> or pay by card <span className="h-px flex-1 bg-sorena-navy/10" />
              </div>
            </>
          )}
          <button onClick={pay} disabled={paying || payingWallet || !accepted} className="flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-xl bg-sorena-gold px-6 py-3.5 font-semibold text-sorena-navy shadow-md transition-all hover:-translate-y-0.5 hover:bg-sorena-gold/90 disabled:opacity-60 disabled:hover:translate-y-0">
            {paying ? <><Loader2 size={18} className="animate-spin" /> Redirecting…</> : `Pay NZD ${hold.amountNZD}`}
          </button>
          {!accepted && <p className="text-center text-xs text-sorena-text/50">Please accept the policy above to continue.</p>}
          <button onClick={resetToPick} disabled={paying || payingWallet} className="flex w-full items-center justify-center gap-1 text-sm font-semibold text-sorena-navy/70 hover:text-sorena-navy"><ArrowLeft size={14} /> Pick a different time</button>
        </div>
      </Shell>
    );
  }

  // ── Pick (date row + that day's slots) ──────────────────────────────
  return (
    <Shell>
      <h1 className="text-xl font-bold text-sorena-navy text-center">Book your {cfg.label}</h1>
      <p className="mt-2 text-center text-sm text-sorena-text/60">NZD {cfg.price} · Pick a day, then a time. You&apos;ll have 15 minutes to pay.</p>
      {pickError && (
        <div className="mt-4 rounded-xl bg-sorena-clay/10 border border-sorena-clay/30 px-4 py-3 text-sm text-sorena-clay text-center">{pickError}</div>
      )}
      {days.length === 0 ? (
        <EmptyCalendarScaffold />
      ) : (
        <>
          <div className="mt-6 -mx-1 flex gap-2 overflow-x-auto pb-2">
            {days.map((d) => {
              const active = d.key === selectedDate;
              return (
                <button key={d.key} onClick={() => setSelectedDate(d.key)} className={['flex-shrink-0 rounded-xl border px-4 py-3 text-center transition-colors min-w-[5.5rem]', active ? 'border-sorena-navy bg-sorena-navy text-white' : 'border-sorena-navy/15 bg-white text-sorena-navy hover:border-sorena-navy/40'].join(' ')}>
                  <span className="block text-sm font-semibold">{d.label}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-5 text-xs text-sorena-text/50 text-center">Times shown in New Zealand time</p>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {activeDay?.slots.map((s) => (
              <button key={s.startUtc} disabled={holding} onClick={() => startHold(s)} className="rounded-xl border border-sorena-navy/15 bg-white px-2 py-3 text-sm font-semibold text-sorena-navy transition-all hover:-translate-y-0.5 hover:border-sorena-gold hover:shadow-sm disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sorena-gold">
                {fmt(s.startUtc, tz, { hour: 'numeric', minute: '2-digit', hour12: true })}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="mt-8"><BackToCase /></div>
    </Shell>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
function BookingRouter() {
  const searchParams = useSearchParams();
  const type = (searchParams.get('type') ?? '').toLowerCase();
  if (type === 'free15') return <FreeBookingFlow />;
  if (type === 'gap') return <PaidBookingFlow sessionType="GAP_CLOSING" />;
  if (type === 'lia') return <PaidBookingFlow sessionType="LIA" />;
  // Bare /portal/booking (or any unknown type) → the standing chooser.
  return <BookingChooser />;
}

export default function PortalBookingPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-xl text-center text-sm text-sorena-text/60">Loading…</div>}>
      <BookingRouter />
    </Suspense>
  );
}
