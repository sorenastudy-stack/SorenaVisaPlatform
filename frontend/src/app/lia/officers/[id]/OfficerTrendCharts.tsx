'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, Activity, Globe } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { DecisionsOverTimeChart } from '../metrics/DecisionsOverTimeChart';
import { TopCountriesChart } from '../metrics/TopCountriesChart';
import { CaseStagePieChart } from '../metrics/CaseStagePieChart';

// PR-LIA-11 — Per-officer trend card on the officer detail page.
//
// Client component because:
//   * Recharts is client-only (we wrap them all)
//   * The window toggle (6 / 12 months) needs to re-fetch without a
//     full page navigation
//
// The platform-wide DecisionsOverTimeChart consumes monthly buckets;
// the per-officer endpoint returns quarterly buckets. We adapt the
// shape here so we can re-use the same chart component.

interface QuarterBucket {
  quarterLabel: string;
  quarterStart: string;
  approved: number;
  declined: number;
  pending: number;
}

interface OfficerTrend {
  officerId: string;
  windowMonths: number;
  generatedAt: string;
  quarterlyDecisions: QuarterBucket[];
  topCountries: Array<{ country: string; caseCount: number }>;
  caseStageDistribution: Array<{ stage: string; count: number }>;
  daysSinceLastLinkage: number | null;
}

export function OfficerTrendCharts({ officerId }: { officerId: string }) {
  const [windowMonths, setWindowMonths] = useState<6 | 12>(6);
  const [data, setData] = useState<OfficerTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<OfficerTrend>(`/officers/${officerId}/metrics?windowMonths=${windowMonths}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Failed to load trends.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [officerId, windowMonths]);

  const decisionsAsMonths = data?.quarterlyDecisions.map((q) => ({
    monthLabel: q.quarterLabel,
    monthStart: q.quarterStart,
    approved: q.approved,
    declined: q.declined,
    pending: q.pending,
  })) ?? [];

  const topCountriesAdapted = data?.topCountries.map((c) => ({
    country: c.country,
    caseCount: c.caseCount,
    approvedCount: 0,
    declinedCount: 0,
  })) ?? [];

  const daysBadgeTone = (() => {
    if (data?.daysSinceLastLinkage == null) return 'bg-gray-100 text-gray-700 border border-gray-200';
    if (data.daysSinceLastLinkage > 180) return 'bg-red-100 text-red-800 border border-red-200';
    if (data.daysSinceLastLinkage > 90)  return 'bg-amber-100 text-amber-800 border border-amber-200';
    return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
  })();
  const daysBadgeLabel = (() => {
    if (!data || data.daysSinceLastLinkage == null) return 'No linkages yet';
    if (data.daysSinceLastLinkage === 0) return 'Last linkage: today';
    return `Last linkage: ${data.daysSinceLastLinkage} day${data.daysSinceLastLinkage === 1 ? '' : 's'} ago`;
  })();

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <h2 className="text-lg font-bold text-[#1E3A5F] flex items-center gap-2">
          <TrendingUp size={18} className="text-[#E8B923]" />
          Decision Trends
        </h2>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ml-2 ${daysBadgeTone}`}>
          {daysBadgeLabel}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setWindowMonths(6)}
            className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              windowMonths === 6
                ? 'bg-[#1E3A5F] text-white'
                : 'bg-white text-[#4A4A4A] border border-gray-200 hover:border-[#1E3A5F] hover:text-[#1E3A5F]'
            }`}
          >
            6 months
          </button>
          <button
            type="button"
            onClick={() => setWindowMonths(12)}
            className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              windowMonths === 12
                ? 'bg-[#1E3A5F] text-white'
                : 'bg-white text-[#4A4A4A] border border-gray-200 hover:border-[#1E3A5F] hover:text-[#1E3A5F]'
            }`}
          >
            12 months
          </button>
        </div>
      </div>

      {loading && (
        <div className="space-y-3">
          <div className="h-80 rounded-xl bg-[#FAF8F3] animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="h-64 rounded-xl bg-[#FAF8F3] animate-pulse" />
            <div className="h-64 rounded-xl bg-[#FAF8F3] animate-pulse" />
          </div>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      )}

      {!loading && !error && data && (
        <div className="space-y-4">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-2 flex items-center gap-1">
              <Activity size={12} /> Quarterly decisions
            </h3>
            <DecisionsOverTimeChart data={decisionsAsMonths} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-2 flex items-center gap-1">
                <Globe size={12} /> Top client countries
              </h3>
              <TopCountriesChart data={topCountriesAdapted} />
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-2 flex items-center gap-1">
                <Activity size={12} /> Case stage at link time
              </h3>
              <CaseStagePieChart data={data.caseStageDistribution} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
