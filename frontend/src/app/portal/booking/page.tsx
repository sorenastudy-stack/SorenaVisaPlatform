'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Calendar, Scale, Sparkles, ArrowLeft, ArrowRight, Check, Loader2, Lock } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatMoneyCents } from '@/lib/money';
import {
  getBookingEligibility,
  reasonText,
  type BookingEligibility,
  type BookingType,
  type TypeEligibility,
} from '@/lib/booking/eligibility';

// Client portal — booking page. Fully i18n'd (booking.* keys); amounts stay Latin
// (formatMoneyCents); dates render via the locale (fa-IR-u-ca-gregory in Persian).

// Icon + slug per type; the title/blurb are translated from booking.* by key.
const CHOOSER_ORDER: BookingType[] = ['FREE_15', 'GAP_CLOSING', 'LIA'];
const TYPE_META: Record<BookingType, { slug: string; key: string; icon: React.ReactNode }> = {
  FREE_15:     { slug: 'free15', key: 'free15', icon: <Calendar size={20} /> },
  GAP_CLOSING: { slug: 'gap',    key: 'gap',    icon: <Sparkles size={20} /> },
  LIA:         { slug: 'lia',    key: 'lia',    icon: <Scale size={20} /> },
};

type Loc = 'en' | 'fa';
function fmt(iso: string, tz: string, opts: Intl.DateTimeFormatOptions, locale: Loc): string {
  const intl = locale === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-NZ';
  return new Intl.DateTimeFormat(intl, { timeZone: tz, ...opts }).format(new Date(iso));
}
function dateKey(iso: string, tz: string): string {
  // Internal sort/group key — always Gregorian ASCII, never localised.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

function BookingChooser() {
  const t = useTranslations('booking');
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
        <h1 className="text-2xl md:text-3xl font-bold text-sorena-navy">{t('chooserTitle')}</h1>
        <p className="mt-2 text-sm text-sorena-text/70">{t('chooserSubtitle')}</p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-sorena-clay/30 bg-sorena-clay/10 px-4 py-3 text-sm text-sorena-clay text-center">
          {t('loadOptionsError')}
        </div>
      )}

      {!elig && !error && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-sorena-text/60">
          <Loader2 size={18} className="animate-spin" /> {t('loadingOptions')}
        </div>
      )}

      {elig && (
        <>
          {!elig.hasSubmission && (
            <div className="mb-5 rounded-2xl border border-[#c9a961]/40 bg-[#c9a961]/10 p-4 text-center">
              <p className="text-sm font-semibold text-sorena-navy">{t('assessFirst')}</p>
              <p className="mt-1 text-xs text-sorena-text/70">{t('assessBody')}</p>
              <Link
                href="/scorecard"
                className="mt-3 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-sorena-navy px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-sorena-navy/90"
              >
                {t('startAssessment')}
              </Link>
            </div>
          )}

          <div className="space-y-4">
            {CHOOSER_ORDER.map((type) => {
              const item = elig.types.find((x) => x.type === type);
              return item ? <BookingTypeCard key={type} item={item} meta={TYPE_META[type]} /> : null;
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
}: { item: TypeEligibility; meta: { slug: string; key: string; icon: React.ReactNode } }) {
  const t = useTranslations('booking');
  const priceLabel = item.paid ? formatMoneyCents(item.priceCents, item.currency) : t('free');
  return (
    <section className="rounded-xl border border-sorena-navy/10 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={['flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl', item.eligible ? 'bg-[#c9a961]/15 text-sorena-navy' : 'bg-sorena-navy/[0.04] text-sorena-navy/40'].join(' ')}>
          {meta.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className={['text-base font-bold', item.eligible ? 'text-sorena-navy' : 'text-sorena-navy/50'].join(' ')}>{t(`${meta.key}Title`)}</h2>
            <span className={['flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold', item.paid ? 'bg-sorena-navy/5 text-sorena-navy' : 'bg-sorena-jade/15 text-sorena-jade', item.eligible ? '' : 'opacity-60'].join(' ')}>{priceLabel}</span>
          </div>
          <p className={['mt-1 text-sm', item.eligible ? 'text-sorena-text/70' : 'text-sorena-text/40'].join(' ')}>{t(`${meta.key}Blurb`)}</p>
        </div>
      </div>

      {item.eligible && item.paid && (
        <div className="mt-3 rounded-lg bg-sorena-navy/[0.03] px-3 py-2 text-xs text-sorena-text/70">
          <div>{t('priceByCard', { card: formatMoneyCents(item.cardTotalCents, item.currency), fee: formatMoneyCents(item.cardFeeCents, item.currency) })}</div>
          <div className="mt-0.5">{t('priceFromWallet', { price: formatMoneyCents(item.priceCents, item.currency) })}</div>
        </div>
      )}

      <div className="mt-4">
        {item.eligible ? (
          <Link
            href={`/portal/booking?type=${meta.slug}`}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#c9a961] px-6 py-3 text-sm font-bold text-sorena-navy shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[#c9a961]/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy"
          >
            {item.paid ? t('bookPaid', { price: priceLabel }) : t('bookNow')} <ArrowRight size={16} className="rtl:rotate-180" />
          </Link>
        ) : (
          <>
            <button
              type="button"
              disabled
              className="inline-flex min-h-[48px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-sorena-navy/5 px-6 py-3 text-sm font-bold text-sorena-navy/40"
            >
              <Lock size={15} /> {t('notAvailable')}
            </button>
            <p className="mt-2 text-xs italic leading-relaxed text-sorena-text/60">{reasonText(item, t)}</p>
          </>
        )}
      </div>
    </section>
  );
}

interface Slot { startUtc: string; endUtc: string; remaining: number; availableStaffIds: string[]; }
interface SlotsResponse { timezone: string; durationMinutes: number; slots: Slot[]; }

type Step = 'pick' | 'review' | 'done';

function FreeBookingFlow() {
  const t = useTranslations('booking');
  const locale = useLocale() as Loc;
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

  const days = useMemo(() => {
    if (!data) return [] as Array<{ key: string; label: string; slots: Slot[] }>;
    const tz = data.timezone;
    const map = new Map<string, { key: string; label: string; slots: Slot[] }>();
    for (const s of data.slots) {
      const key = dateKey(s.startUtc, tz);
      if (!map.has(key)) {
        map.set(key, { key, label: fmt(s.startUtc, tz, { weekday: 'short', day: 'numeric', month: 'short' }, locale), slots: [] });
      }
      map.get(key)!.slots.push(s);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [data, locale]);

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
      await api.post('/booking/confirm', {
        type: 'FREE_15',
        slotStartUtc: selectedSlot.startUtc,
      });
      setStep('done');
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 403) {
        setFreeUsed(true);
      } else if (err instanceof ApiError && err.statusCode === 409) {
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

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-12 text-sorena-text/60">
          <Loader2 size={18} className="animate-spin" /> {t('findingTimes')}
        </div>
      </Shell>
    );
  }
  if (freeUsed) {
    return (
      <Shell>
        <div className="text-center py-2">
          <h1 className="text-xl font-bold text-sorena-navy">{t('freeUsedTitle')}</h1>
          <p className="mt-3 text-sm text-sorena-text/75">{t('freeUsedBody')}</p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <Link
              href="/portal/booking?type=gap"
              className="inline-flex min-h-[3rem] items-center justify-center rounded-xl bg-[#c9a961] px-8 py-3 font-semibold text-sorena-navy shadow-md transition-all hover:-translate-y-0.5 hover:bg-[#c9a961]/90"
            >
              {t('explorePaid')}
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
        <p className="text-center text-sm text-sorena-text/70 py-8">{t('loadTimesError')}</p>
        <div className="text-center">
          <button onClick={loadSlots} className="text-sm font-semibold text-sorena-navy underline">{t('tryAgain')}</button>
        </div>
      </Shell>
    );
  }

  if (step === 'done' && selectedSlot) {
    return (
      <Shell>
        <div className="text-center py-4">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-sorena-jade/15">
            <Check size={26} className="text-sorena-jade" />
          </div>
          <h1 className="text-2xl font-bold text-sorena-navy">{t('booked')}</h1>
          <p className="mt-3 text-base text-sorena-text/80">
            {fmt(selectedSlot.startUtc, tz, { weekday: 'long', day: 'numeric', month: 'long' }, locale)}
            {' · '}
            {fmt(selectedSlot.startUtc, tz, { hour: 'numeric', minute: '2-digit', hour12: true }, locale)} NZ
          </p>
          <p className="mt-1 text-sm text-sorena-text/60">{t('seeYouThen')}</p>
          <div className="mt-8"><BackToCase /></div>
        </div>
      </Shell>
    );
  }

  if (step === 'review' && selectedSlot) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-sorena-navy text-center">{t('reviewTitle')}</h1>
        <div className="mt-6 rounded-2xl bg-sorena-cream border border-sorena-navy/10 p-5 text-center">
          <p className="text-xs uppercase tracking-wide text-sorena-text/50 font-semibold">{t('free15Title')}</p>
          <p className="mt-2 text-lg font-bold text-sorena-navy">
            {fmt(selectedSlot.startUtc, tz, { weekday: 'long', day: 'numeric', month: 'long' }, locale)}
          </p>
          <p className="text-lg font-semibold text-sorena-navy">
            {fmt(selectedSlot.startUtc, tz, { hour: 'numeric', minute: '2-digit', hour12: true }, locale)} NZ
          </p>
          <p className="mt-2 text-xs text-sorena-text/50">{t('nzTimeNote')}</p>
        </div>
        <div className="mt-6 space-y-3">
          <button
            onClick={confirm}
            disabled={submitting}
            className="flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-xl bg-[#c9a961] px-6 py-3.5 font-semibold text-sorena-navy shadow-md transition-all hover:-translate-y-0.5 hover:bg-[#c9a961]/90 hover:shadow-xl disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy"
          >
            {submitting ? <><Loader2 size={18} className="animate-spin" /> {t('confirming')}</> : t('confirmBooking')}
          </button>
          <button
            onClick={() => { setStep('pick'); }}
            disabled={submitting}
            className="flex w-full items-center justify-center gap-1 text-sm font-semibold text-sorena-navy/70 hover:text-sorena-navy"
          >
            <ArrowLeft size={14} className="rtl:rotate-180" /> {t('back')}
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-bold text-sorena-navy text-center">{t('pickTitleFree')}</h1>
      <p className="mt-2 text-center text-sm text-sorena-text/60">{t('pickSubtitle')}</p>

      {takenError && (
        <div className="mt-4 rounded-xl bg-sorena-clay/10 border border-sorena-clay/30 px-4 py-3 text-sm text-sorena-clay text-center">
          {t('justTaken')}
        </div>
      )}

      {days.length === 0 ? (
        <EmptyCalendarScaffold />
      ) : (
        <>
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
                    {t('slotCount', { count: d.slots.length })}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-5 text-xs text-sorena-text/50 text-center">{t('nzTimeNote')}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {activeDay?.slots.map((s) => (
              <button
                key={s.startUtc}
                onClick={() => { setSelectedSlot(s); setStep('review'); }}
                className="flex flex-col items-center rounded-xl border border-sorena-navy/15 bg-white px-2 py-2.5 text-sm font-semibold text-sorena-navy transition-all hover:-translate-y-0.5 hover:border-[#c9a961] hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a961]"
              >
                {fmt(s.startUtc, tz, { hour: 'numeric', minute: '2-digit', hour12: true }, locale)}
                {s.remaining === 1 && (
                  <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-sorena-clay">{t('oneLeft')}</span>
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl">
      <section className="rounded-2xl bg-white border border-sorena-navy/10 p-6 md:p-8 shadow-sm">{children}</section>
    </div>
  );
}
function BackToCase() {
  const t = useTranslations('booking');
  return (
    <div className="text-center">
      <Link href="/portal/case" className="text-sm font-semibold text-sorena-navy/70 underline underline-offset-4 hover:text-sorena-navy">
        {t('backToCase')}
      </Link>
    </div>
  );
}

function EmptyCalendarScaffold() {
  const t = useTranslations('booking');
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
      <p className="mt-5 text-xs text-sorena-text/50 text-center">{t('nzTimeNote')}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4" aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[42px] rounded-xl border border-sorena-navy/10 bg-sorena-navy/[0.03]" />
        ))}
      </div>
      <p className="mt-4 text-center text-sm text-sorena-text/60">{t('noOpenTimes')}</p>
    </>
  );
}

// ── Paid flow: GAP_CLOSING + LIA ──────────────────────────────────────
interface Hold {
  consultationId: string; holdExpiresAt: string; amountNZD: number;
  // PR-GST-SESSIONS — walletCents is base + GST, computed server-side. amountNZD
  // remains the PRE-GST base (the stored column), so it must never be used as a
  // price on screen: doing so is what showed "Pay USD 20.00" for a 23.00 debit.
  gstCents?: number; walletCents?: number;
  currency: string; cardFeeCents: number; cardTotalCents: number;
  type: string; slotStartUtc: string; staffName: string; timezone: string;
}
type GapStep = 'pick' | 'hold' | 'expired' | 'done';

function PaidBookingFlow({ sessionType }: { sessionType: 'GAP_CLOSING' | 'LIA' }) {
  const t = useTranslations('booking');
  const locale = useLocale() as Loc;
  const cfgLabel = sessionType === 'GAP_CLOSING' ? t('gapSession') : t('liaSession45');
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
  const [accepted, setAccepted] = useState(false);
  const [walletCents, setWalletCents] = useState<number | null>(null);
  const [payingWallet, setPayingWallet] = useState(false);
  const [doneBalanceCents, setDoneBalanceCents] = useState<number | null>(null);
  const [pricing, setPricing] = useState<TypeEligibility | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBookingEligibility()
      .then((e) => { if (!cancelled) setPricing(e.types.find((ty) => ty.type === sessionType) ?? null); })
      .catch(() => { /* header omits the price on failure; the hold amount is authoritative */ });
    return () => { cancelled = true; };
  }, [sessionType]);

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
      if (!map.has(key)) map.set(key, { key, label: fmt(s.startUtc, tz, { weekday: 'short', day: 'numeric', month: 'short' }, locale), slots: [] });
      map.get(key)!.slots.push(s);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [data, locale]);
  useEffect(() => { if (!selectedDate && days.length > 0) setSelectedDate(days[0].key); }, [days, selectedDate]);

  const tz = data?.timezone ?? 'Pacific/Auckland';
  const activeDay = days.find((d) => d.key === selectedDate) ?? null;

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
      setPickError(t('noLongerAvailable'));
      await loadSlots();
    } finally { setHolding(false); }
  }

  async function pay() {
    if (!hold || !accepted) return;
    setPaying(true);
    try {
      const { url } = await api.post<{ url: string }>('/booking/checkout', { consultationId: hold.consultationId, accepted: true });
      window.location.href = url;
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) { setStep('expired'); }
      else { setStep('expired'); }
    } finally { setPaying(false); }
  }

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
        setWalletCents(null);
      } else {
        setStep('expired');
      }
    } finally { setPayingWallet(false); }
  }

  function resetToPick() { setHold(null); setStep('pick'); loadSlots(); }

  if (loading) {
    return <Shell><div className="flex items-center justify-center gap-2 py-12 text-sorena-text/60"><Loader2 size={18} className="animate-spin" /> {t('findingTimes')}</div></Shell>;
  }
  if (loadError) {
    return <Shell><p className="text-center text-sm text-sorena-text/70 py-8">{t('loadTimesError')}</p><div className="text-center"><button onClick={loadSlots} className="text-sm font-semibold text-sorena-navy underline">{t('tryAgain')}</button></div></Shell>;
  }

  if (step === 'expired') {
    return (
      <Shell>
        <div className="text-center py-2">
          <h1 className="text-xl font-bold text-sorena-navy">{t('holdExpiredTitle')}</h1>
          <p className="mt-3 text-sm text-sorena-text/75">{t('noCharge')}</p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <button onClick={resetToPick} className="inline-flex min-h-[3rem] items-center justify-center rounded-xl bg-[#c9a961] px-8 py-3 font-semibold text-sorena-navy shadow-md hover:bg-[#c9a961]/90">{t('pickTime')}</button>
            <BackToCase />
          </div>
        </div>
      </Shell>
    );
  }

  if (step === 'done') {
    return (
      <Shell>
        <div className="text-center py-4">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-sorena-jade/15">
            <Check size={26} className="text-sorena-jade" />
          </div>
          <h1 className="text-2xl font-bold text-sorena-navy">{t('booked')}</h1>
          <p className="mt-3 text-base text-sorena-text/80">
            {t('walletPaid')}
            {doneBalanceCents != null && ` ${t('newBalance', { balance: formatMoneyCents(doneBalanceCents, hold?.currency ?? pricing?.currency ?? 'NZD') })}`}
          </p>
          <p className="mt-1 text-sm text-sorena-text/60">{t('emailConfirm')}</p>
          <div className="mt-8"><BackToCase /></div>
        </div>
      </Shell>
    );
  }

  if (step === 'hold' && hold) {
    const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
    const ss = String(secondsLeft % 60).padStart(2, '0');
    // What the wallet is actually debited. Falls back to the base only if an
    // older server build omits the field, so this can never render NaN.
    const walletDue = hold.walletCents ?? Math.round(hold.amountNZD * 100);
    return (
      <Shell>
        <h1 className="text-xl font-bold text-sorena-navy text-center">{t('confirmPay')}</h1>
        <div className="mt-6 rounded-2xl bg-sorena-cream border border-sorena-navy/10 p-5 text-center">
          <p className="text-xs uppercase tracking-wide text-sorena-text/50 font-semibold">{cfgLabel} · {formatMoneyCents(walletDue, hold.currency)}</p>
          <p className="mt-2 text-lg font-bold text-sorena-navy">{fmt(hold.slotStartUtc, tz, { weekday: 'long', day: 'numeric', month: 'long' }, locale)}</p>
          <p className="text-lg font-semibold text-sorena-navy">{fmt(hold.slotStartUtc, tz, { hour: 'numeric', minute: '2-digit', hour12: true }, locale)} NZ</p>
          <p className="mt-1 text-xs text-sorena-text/50">{t('withStaff', { name: hold.staffName })}</p>
        </div>
        <div className="mt-5 text-center">
          <p className="text-sm text-sorena-text/70">{t('holdingTime')}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-sorena-navy">{mm}:{ss}</p>
          <p className="text-xs text-sorena-text/50">{t('minutesLeft')}</p>
        </div>
        {/* Cancellation & refund policy — must be accepted before paying. */}
        <div className="mt-6 rounded-xl border border-sorena-navy/10 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-sorena-text/50">{t('policyTitle')}</p>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-sorena-text/70">
            <li>• {t('policyBullet24h')}</li>
            <li>• {t('policyBullet24hLate')}</li>
            <li>• {t('policyNoShow')}</li>
            <li>• {t('policyCredit')}</li>
          </ul>
          <label className="mt-3 flex items-start gap-2 text-sm text-sorena-navy">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-4 w-4 rounded" />
            <span>{t('policyAccept')}</span>
          </label>
        </div>

        <div className="mt-6 space-y-3">
          {walletCents != null && walletCents >= walletDue && (
            <>
              <button onClick={payWithWallet} disabled={payingWallet || paying || !accepted} className="flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-xl bg-sorena-navy px-6 py-3.5 font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-sorena-navy/90 disabled:opacity-60 disabled:hover:translate-y-0">
                {payingWallet ? <><Loader2 size={18} className="animate-spin" /> {t('paying')}</> : t('payWallet', { amount: formatMoneyCents(walletDue, hold.currency) })}
              </button>
              <p className="text-center text-xs text-sorena-text/50">
                {t('walletBalanceNote', { balance: formatMoneyCents(walletCents, hold.currency), after: formatMoneyCents(walletCents - walletDue, hold.currency) })}
              </p>
              <div className="flex items-center gap-3 py-1 text-xs text-sorena-text/40">
                <span className="h-px flex-1 bg-sorena-navy/10" /> {t('orPayCard')} <span className="h-px flex-1 bg-sorena-navy/10" />
              </div>
            </>
          )}
          <button onClick={pay} disabled={paying || payingWallet || !accepted} className="flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-xl bg-[#c9a961] px-6 py-3.5 font-semibold text-sorena-navy shadow-md transition-all hover:-translate-y-0.5 hover:bg-[#c9a961]/90 disabled:opacity-60 disabled:hover:translate-y-0">
            {paying ? <><Loader2 size={18} className="animate-spin" /> {t('redirecting')}</> : t('payCard', { amount: formatMoneyCents(hold.cardTotalCents, hold.currency) })}
          </button>
          {hold.cardFeeCents > 0 && (
            <p className="text-center text-xs text-sorena-text/50">{t('cardFeeNote', { fee: formatMoneyCents(hold.cardFeeCents, hold.currency) })}</p>
          )}
          {!accepted && <p className="text-center text-xs text-sorena-text/50">{t('acceptToContinue')}</p>}
          <button onClick={resetToPick} disabled={paying || payingWallet} className="flex w-full items-center justify-center gap-1 text-sm font-semibold text-sorena-navy/70 hover:text-sorena-navy"><ArrowLeft size={14} className="rtl:rotate-180" /> {t('pickDifferent')}</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-bold text-sorena-navy text-center">{t('pickTitlePaid', { label: cfgLabel })}</h1>
      <p className="mt-2 text-center text-sm text-sorena-text/60">{t('pickSubtitlePaid')}</p>
      {pricing && (
        <div className="mx-auto mt-3 max-w-sm rounded-lg bg-sorena-navy/[0.03] px-3 py-2 text-center text-xs text-sorena-text/70">
          <div>{t('priceByCard', { card: formatMoneyCents(pricing.cardTotalCents, pricing.currency), fee: formatMoneyCents(pricing.cardFeeCents, pricing.currency) })}</div>
          <div className="mt-0.5">{t('priceFromWallet', { price: formatMoneyCents(pricing.priceCents, pricing.currency) })}</div>
        </div>
      )}
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
          <p className="mt-5 text-xs text-sorena-text/50 text-center">{t('nzTimeNote')}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {activeDay?.slots.map((s) => (
              <button key={s.startUtc} disabled={holding} onClick={() => startHold(s)} className="rounded-xl border border-sorena-navy/15 bg-white px-2 py-3 text-sm font-semibold text-sorena-navy transition-all hover:-translate-y-0.5 hover:border-[#c9a961] hover:shadow-sm disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a961]">
                {fmt(s.startUtc, tz, { hour: 'numeric', minute: '2-digit', hour12: true }, locale)}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="mt-8"><BackToCase /></div>
    </Shell>
  );
}

function BookingRouter() {
  const searchParams = useSearchParams();
  const type = (searchParams.get('type') ?? '').toLowerCase();
  if (type === 'free15') return <FreeBookingFlow />;
  if (type === 'gap') return <PaidBookingFlow sessionType="GAP_CLOSING" />;
  if (type === 'lia') return <PaidBookingFlow sessionType="LIA" />;
  return <BookingChooser />;
}

function BookingLoading() {
  const t = useTranslations('booking');
  return <div className="mx-auto max-w-xl text-center text-sm text-sorena-text/60">{t('loading')}</div>;
}

export default function PortalBookingPage() {
  return (
    <Suspense fallback={<BookingLoading />}>
      <BookingRouter />
    </Suspense>
  );
}
