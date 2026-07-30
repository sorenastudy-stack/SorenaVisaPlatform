'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  GraduationCap, Loader2, Sparkles, RefreshCw, MapPin, Clock, Wallet, Lock,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-RECS-1 (slice 1) — the student's programme matches: a persisted, sortable
// ranked list (view-only). Empty state → one primary action ("Find my matches").
// Navy/gold portal palette, mobile-first. No slot selection here (slice 2).

interface WhyDim { dim: string; verdict: string; detail: string }
interface RecItem {
  id: string; rank: number; fitScore: number; institutionType: 'UNIVERSITY' | 'ITP' | 'PTE' | null;
  why: WhyDim[] | null; programmeId: string; programmeName: string; providerName: string;
  city: string | null; level: string | null; nzqfLevel: string | null; tuitionFeeNZD: number | null;
  currency: string | null; durationMonths: number | null; durationText: string | null;
  rankingTier: string | null;
}
interface RecList {
  listId: string; status: string; criteriaSource: string; generatedAt: string; items: RecItem[];
}

const SORTS = [
  { key: 'default', label: 'Best match' },
  { key: 'tuition', label: 'Lowest tuition' },
  { key: 'startDate', label: 'Earliest start' },
  { key: 'duration', label: 'Shortest' },
  { key: 'city', label: 'City' },
  { key: 'featured', label: 'Featured' },
] as const;
type SortKey = (typeof SORTS)[number]['key'];

const INSTITUTION_LABEL: Record<string, string> = { UNIVERSITY: 'University', ITP: 'Polytechnic', PTE: 'College' };

function matchLabel(fit: number): string {
  if (fit >= 0.7) return 'Strong match';
  if (fit >= 0.55) return 'Good match';
  return 'Possible match';
}

function durationLabel(it: RecItem): string | null {
  if (it.durationText) return it.durationText;
  if (it.durationMonths) {
    const y = it.durationMonths / 12;
    return Number.isInteger(y) ? `${y} year${y === 1 ? '' : 's'}` : `${it.durationMonths} months`;
  }
  return null;
}

export function RecommendationsClient() {
  const [list, setList] = useState<RecList | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'empty' | 'gated' | 'error'>('loading');
  const [sort, setSort] = useState<SortKey>('default');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (s: SortKey) => {
    try {
      const data = await api.get<RecList | null>(`/student/recommendations?sort=${s}`);
      if (!data) { setPhase('empty'); setList(null); return; }
      setList(data); setPhase('ready');
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 403) { setPhase('gated'); return; }
      setPhase('error');
    }
  }, []);

  useEffect(() => { load(sort); }, [sort, load]);

  const generate = async () => {
    setBusy(true);
    try {
      await api.post('/student/recommendations/generate', {});
      await load(sort);
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 403) setPhase('gated');
      else setPhase('error');
    } finally { setBusy(false); }
  };

  // ── States ─────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return <Shell><div className="flex justify-center py-16"><Loader2 className="animate-spin text-[#c9a961]" /></div></Shell>;
  }

  if (phase === 'gated') {
    return (
      <Shell>
        <Card className="text-center">
          <Lock className="mx-auto mb-3 text-[#c9a961]" size={28} />
          <h2 className="text-base font-bold text-[#1e3a5f]">Your matches unlock after payment</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-gray-600">Once your engagement fee is paid, we’ll show your personalised programme matches here.</p>
          <Link href="/student/payments" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#1e3a5f] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#162d4a]">
            Go to payments
          </Link>
        </Card>
      </Shell>
    );
  }

  if (phase === 'error') {
    return (
      <Shell>
        <Card className="text-center">
          <p className="text-sm text-gray-600">We couldn’t load your matches just now.</p>
          <button onClick={() => { setPhase('loading'); load(sort); }} className="mt-4 text-sm font-medium text-[#1e3a5f] underline">Try again</button>
        </Card>
      </Shell>
    );
  }

  if (phase === 'empty') {
    return (
      <Shell>
        <Card className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#c9a961]/15">
            <Sparkles className="text-[#c9a961]" size={26} />
          </div>
          <h2 className="text-base font-bold text-[#1e3a5f]">Let’s find your programme matches</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-gray-600">
            We’ll use your assessment answers to suggest study options that fit your background, budget, and goals.
          </p>
          <button onClick={generate} disabled={busy}
            className="mx-auto mt-6 inline-flex items-center gap-2 rounded-xl bg-[#1e3a5f] px-6 py-3 text-sm font-semibold text-white hover:bg-[#162d4a] disabled:opacity-60">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Find my matches
          </button>
        </Card>
      </Shell>
    );
  }

  // phase === 'ready'
  const items = list?.items ?? [];
  return (
    <Shell>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500">
          {items.length} {items.length === 1 ? 'option' : 'options'} · based on your assessment
        </p>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="sort">Sort</label>
          <select id="sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-[#1e3a5f] sm:w-auto">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button onClick={generate} disabled={busy} title="Refresh matches"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-300 px-3 py-2 text-sm font-medium text-[#1e3a5f] hover:bg-gray-50 disabled:opacity-60">
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <Card className="mt-4 text-center">
          <p className="text-sm text-gray-600">No matching programmes yet. Your advisor will help identify options with you.</p>
        </Card>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((it) => (
            <li key={it.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1e3a5f] text-xs font-bold text-white">{it.rank}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <p className="text-sm font-bold text-[#1e3a5f]">{it.programmeName}</p>
                    <span className="shrink-0 rounded-full bg-[#c9a961]/15 px-2.5 py-0.5 text-xs font-semibold text-[#8a6d29]">{matchLabel(it.fitScore)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {it.providerName}
                    {it.institutionType ? ` · ${INSTITUTION_LABEL[it.institutionType] ?? it.institutionType}` : ''}
                    {it.rankingTier ? ` · ${it.rankingTier}` : ''}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                    {it.city && <span className="inline-flex items-center gap-1"><MapPin size={12} className="text-gray-400" />{it.city}</span>}
                    {durationLabel(it) && <span className="inline-flex items-center gap-1"><Clock size={12} className="text-gray-400" />{durationLabel(it)}</span>}
                    {it.tuitionFeeNZD != null && (
                      <span className="inline-flex items-center gap-1"><Wallet size={12} className="text-gray-400" />
                        {(it.currency ?? 'NZD')} {it.tuitionFeeNZD.toLocaleString('en-NZ')}
                      </span>
                    )}
                    {it.nzqfLevel && <span className="text-gray-400">NZQF {it.nzqfLevel.replace('LEVEL_', 'L')}</span>}
                  </div>

                  {Array.isArray(it.why) && it.why.length > 0 && (
                    <ul className="mt-2.5 space-y-0.5 border-t border-gray-100 pt-2.5">
                      {it.why.slice(0, 3).map((w, i) => (
                        <li key={i} className="text-xs text-gray-600">• {w.detail}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-5 text-center text-xs text-gray-400">
        These are starting suggestions — your advisor will refine them with you before you choose your priority list.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <div className="mb-5 flex items-center gap-2.5">
        <GraduationCap className="text-[#1e3a5f]" size={22} />
        <div>
          <h1 className="text-lg font-bold text-[#1e3a5f]">Programme matches</h1>
          <p className="text-xs text-gray-500">Study options suggested for you, newest first.</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-gray-200 bg-white p-6 shadow-sm ${className}`}>{children}</div>;
}
