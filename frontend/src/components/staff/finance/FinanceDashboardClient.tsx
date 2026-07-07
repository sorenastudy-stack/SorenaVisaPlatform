'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, CheckCircle2, TrendingUp, Loader2, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';

// Finance portal — read-only dashboard. Three cards: payments awaiting
// confirmation (→ Processing), confirmed in the last 7 days, confirmed all-time.
// Data from GET /staff/finance/dashboard (FINANCE/OWNER-gated server-side).

interface Total { currency: string; amountCents: number; amountLabel: string }
interface Bucket { count: number; totals: Total[] }
interface Dashboard {
  pendingCount: number;
  confirmedThisWeek: Bucket;
  confirmedAllTime: Bucket;
}

function totalsText(totals: Total[]): string {
  if (!totals.length) return '—';
  return totals.map((t) => t.amountLabel).join(' · ');
}

export function FinanceDashboardClient() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get<Dashboard>('/staff/finance/dashboard').then(setData).catch(() => setError(true));
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-1 flex items-center gap-2">
        <TrendingUp size={20} className="text-sorena-navy" />
        <h1 className="text-2xl font-bold text-sorena-navy">Finance dashboard</h1>
      </div>
      <p className="mb-6 text-sm text-sorena-text/70">A quick overview of payment confirmations.</p>

      {error && <p className="text-sm text-red-600">Couldn’t load the dashboard. Please refresh.</p>}
      {!data && !error && (
        <div className="flex items-center gap-2 py-12 text-sorena-text/60">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Awaiting confirmation → links to Processing */}
          <Link
            href="/staff/payments"
            className="group rounded-2xl border border-sorena-gold/40 bg-[#faf8f3] p-5 shadow-sm ring-1 ring-sorena-gold/10 transition-colors hover:bg-[#f5efe0]"
          >
            <div className="flex items-center gap-2 text-[#8a6d10]">
              <Clock size={16} />
              <span className="text-xs font-bold uppercase tracking-wide">Awaiting confirmation</span>
            </div>
            <p className="mt-3 text-4xl font-bold tracking-tight text-sorena-navy">{data.pendingCount}</p>
            <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-sorena-navy">
              Go to Processing <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
            </p>
          </Link>

          {/* Confirmed this week */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sorena-jade">
              <CheckCircle2 size={16} />
              <span className="text-xs font-bold uppercase tracking-wide">Confirmed · last 7 days</span>
            </div>
            <p className="mt-3 text-4xl font-bold tracking-tight text-sorena-navy">{data.confirmedThisWeek.count}</p>
            <p className="mt-2 text-xs text-sorena-text/60">{totalsText(data.confirmedThisWeek.totals)}</p>
          </div>

          {/* Confirmed all-time */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sorena-navy/70">
              <CheckCircle2 size={16} />
              <span className="text-xs font-bold uppercase tracking-wide">Confirmed · all time</span>
            </div>
            <p className="mt-3 text-4xl font-bold tracking-tight text-sorena-navy">{data.confirmedAllTime.count}</p>
            <p className="mt-2 text-xs text-sorena-text/60">{totalsText(data.confirmedAllTime.totals)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
