import Link from 'next/link';
import { BarChart3, Activity, AlertTriangle, TrendingUp, Sparkles, UserPlus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { BackLink } from '@/components/ui/BackLink';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { formatRelative } from '../../_utils/format';
import { DecisionsOverTimeChart } from './DecisionsOverTimeChart';
import { TopCountriesChart } from './TopCountriesChart';
import { CaseStagePieChart } from './CaseStagePieChart';
import { ApprovalRateBar } from './ApprovalRateBar';

// PR-LIA-11 — Officer Metrics platform dashboard.
//
// Role gate: OWNER / ADMIN / SUPER_ADMIN only. Backend enforces too,
// but we redirect early here to keep the dev experience clean (no
// flash of empty cards before the API 403s).

interface PlatformMetrics {
  windowMonths: number;
  generatedAt: string;
  totals: {
    totalOfficers: number;
    activeOfficers: number;
    totalLinkages: number;
    totalDecisions: number;
    approvedCount: number;
    declinedCount: number;
    pendingCount: number;
  };
  decisionsOverTime: Array<{
    monthLabel: string;
    monthStart: string;
    approved: number;
    declined: number;
    pending: number;
  }>;
  approvalRateLeaderboard: Array<{
    officerId: string;
    fullName: string;
    branch: string | null;
    totalDecisions: number;
    approvalRatePct: number;
    declineRatePct: number;
  }>;
  topCountries: Array<{
    country: string;
    caseCount: number;
    approvedCount: number;
    declinedCount: number;
  }>;
  caseStageDistribution: Array<{
    stage: string;
    count: number;
  }>;
}

interface Outliers {
  generatedAt: string;
  highDeclineRate: Array<{
    officerId: string;
    fullName: string;
    branch: string | null;
    totalDecisions: number;
    declineRatePct: number;
  }>;
  underObserved: Array<{
    officerId: string;
    fullName: string;
    totalLinkages: number;
    observationCount: number;
  }>;
  mostActive: Array<{
    officerId: string;
    fullName: string;
    branch: string | null;
    recentLinkageCount: number;
  }>;
  newOnPlatform: Array<{
    officerId: string;
    fullName: string;
    firstLinkedAt: string;
  }>;
  thresholds: {
    highDeclineRatePct: number;
    highDeclineMinDecisions: number;
    underObservedMinLinkages: number;
    underObservedMaxObservations: number;
    mostActiveWindowDays: number;
    newOnPlatformWindowDays: number;
    highDeclineWindowMonths: number;
  };
}

type SearchParams = { windowMonths?: string };

export default async function OfficerMetricsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!session || !['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(session.role)) {
    redirect('/unauthorized');
  }

  const windowMonths = searchParams.windowMonths === '12' ? 12 : 6;

  let metrics: PlatformMetrics | null = null;
  let outliers: Outliers | null = null;
  let errorMsg: string | null = null;
  try {
    metrics = await apiServer.get<PlatformMetrics>(
      `/officers/metrics?windowMonths=${windowMonths}`,
    );
  } catch (e) {
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load metrics.';
  }
  try {
    outliers = await apiServer.get<Outliers>('/officers/metrics/outliers');
  } catch {
    // Non-fatal — outliers card stays empty if it fails.
    outliers = null;
  }

  if (errorMsg || !metrics) {
    return (
      <div className="max-w-7xl">
        <BackLink href="/lia/officers" label="Back to officers" />
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">
            {errorMsg ?? 'Metrics unavailable.'}
          </CardContent>
        </Card>
      </div>
    );
  }

  const overallApprovalPct = metrics.totals.totalDecisions > 0
    ? Math.round((metrics.totals.approvedCount / metrics.totals.totalDecisions) * 1000) / 10
    : 0;
  const overallDeclinePct = metrics.totals.totalDecisions > 0
    ? Math.round((metrics.totals.declinedCount / metrics.totals.totalDecisions) * 1000) / 10
    : 0;

  return (
    <div className="max-w-7xl">
      <BackLink href="/lia/officers" label="Back to officers" />

      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <BarChart3 size={22} className="text-[#E8B923]" />
            Officer Metrics
          </h1>
          <p className="text-sm text-[#4A4A4A]/70 mt-1">
            Cross-officer analytics over the last {windowMonths} months. Updated at request time.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#FAF8F3] text-[#4A4A4A] border border-gray-200">
            Generated {formatRelative(metrics.generatedAt)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-6">
        <span className="text-xs font-semibold text-[#4A4A4A]/70 w-24 flex-shrink-0">Window</span>
        <Link
          href="/lia/officers/metrics?windowMonths=6"
          className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold ${
            windowMonths === 6
              ? 'bg-[#1E3A5F] text-white'
              : 'bg-white text-[#4A4A4A] border border-gray-200 hover:border-[#1E3A5F] hover:text-[#1E3A5F]'
          }`}
        >
          6 months
        </Link>
        <Link
          href="/lia/officers/metrics?windowMonths=12"
          className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold ${
            windowMonths === 12
              ? 'bg-[#1E3A5F] text-white'
              : 'bg-white text-[#4A4A4A] border border-gray-200 hover:border-[#1E3A5F] hover:text-[#1E3A5F]'
          }`}
        >
          12 months
        </Link>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <StatTile label="Active officers" value={metrics.totals.activeOfficers} tone="navy" />
        <StatTile label="Total linkages" value={metrics.totals.totalLinkages} tone="gold" />
        <StatTile label="Total decisions" value={metrics.totals.totalDecisions} tone="blue" />
        <StatTile label="Approval rate" value={`${overallApprovalPct}%`} tone="emerald" />
        <StatTile label="Decline rate" value={`${overallDeclinePct}%`} tone="red" />
      </div>

      {/* Decisions over time */}
      <Card className="mb-6">
        <CardContent>
          <h2 className="text-lg font-bold text-[#1E3A5F] flex items-center gap-2 mb-4">
            <Activity size={18} className="text-[#E8B923]" />
            Decisions over time
          </h2>
          <DecisionsOverTimeChart data={metrics.decisionsOverTime} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Approval-rate leaderboard */}
        <Card>
          <CardContent>
            <h2 className="text-lg font-bold text-[#1E3A5F] flex items-center gap-2 mb-4">
              <TrendingUp size={18} className="text-[#E8B923]" />
              Top 10 by activity — approval rate
            </h2>
            {metrics.approvalRateLeaderboard.length === 0 ? (
              <p className="text-sm text-[#4A4A4A]/60 italic py-6 text-center">
                No officers with recorded decisions in this window.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#FAF8F3] text-[#4A4A4A]/70 text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2 text-left">Officer</th>
                      <th className="px-3 py-2 text-left">Branch</th>
                      <th className="px-3 py-2 text-left">Decisions</th>
                      <th className="px-3 py-2 text-left w-40">Approval %</th>
                      <th className="px-3 py-2 text-right">Decline %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {metrics.approvalRateLeaderboard.map((o) => (
                      <tr key={o.officerId} className="hover:bg-[#FAF8F3]/50">
                        <td className="px-3 py-2">
                          <Link href={`/lia/officers/${o.officerId}`} className="font-semibold text-[#1E3A5F] hover:text-[#E8B923]">
                            {o.fullName}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-xs text-[#4A4A4A]">{o.branch ?? '—'}</td>
                        <td className="px-3 py-2 text-[#4A4A4A] font-mono text-xs">{o.totalDecisions}</td>
                        <td className="px-3 py-2"><ApprovalRateBar rate={o.approvalRatePct} /></td>
                        <td className="px-3 py-2 text-right text-xs text-red-700 font-semibold">{o.declineRatePct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top countries */}
        <Card>
          <CardContent>
            <h2 className="text-lg font-bold text-[#1E3A5F] flex items-center gap-2 mb-4">
              <TrendingUp size={18} className="text-[#E8B923]" />
              Top countries by case volume
            </h2>
            <TopCountriesChart data={metrics.topCountries} />
          </CardContent>
        </Card>
      </div>

      {/* Case stages */}
      <Card className="mb-6">
        <CardContent>
          <h2 className="text-lg font-bold text-[#1E3A5F] flex items-center gap-2 mb-4">
            <Activity size={18} className="text-[#E8B923]" />
            Case stages at link time
          </h2>
          <CaseStagePieChart data={metrics.caseStageDistribution} />
        </CardContent>
      </Card>

      {/* Outliers */}
      {outliers && (
        <Card className="mb-6">
          <CardContent>
            <details open>
              <summary className="cursor-pointer">
                <span className="text-lg font-bold text-[#1E3A5F] inline-flex items-center gap-2">
                  <AlertTriangle size={18} className="text-[#E8B923]" />
                  Outliers
                </span>
                <span className="text-xs text-[#4A4A4A]/60 ml-2">
                  · Thresholds: ≥{outliers.thresholds.highDeclineRatePct}% decline over {outliers.thresholds.highDeclineMinDecisions}+ decisions ({outliers.thresholds.highDeclineWindowMonths}mo window)
                </span>
              </summary>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
                <OutlierCard
                  title="High decline rate"
                  icon={<AlertTriangle size={14} />}
                  tone="red"
                  rows={outliers.highDeclineRate.slice(0, 5).map((o) => ({
                    id: o.officerId,
                    name: o.fullName,
                    sub: o.branch ?? '—',
                    detail: `${o.declineRatePct}% of ${o.totalDecisions}`,
                  }))}
                />
                <OutlierCard
                  title="Under-observed"
                  icon={<Activity size={14} />}
                  tone="amber"
                  rows={outliers.underObserved.slice(0, 5).map((o) => ({
                    id: o.officerId,
                    name: o.fullName,
                    sub: `${o.totalLinkages} linkages`,
                    detail: `${o.observationCount} observations`,
                  }))}
                />
                <OutlierCard
                  title="Most active (30d)"
                  icon={<Sparkles size={14} />}
                  tone="emerald"
                  rows={outliers.mostActive.map((o) => ({
                    id: o.officerId,
                    name: o.fullName,
                    sub: o.branch ?? '—',
                    detail: `${o.recentLinkageCount} linkages`,
                  }))}
                />
                <OutlierCard
                  title="New on platform"
                  icon={<UserPlus size={14} />}
                  tone="gold"
                  rows={outliers.newOnPlatform.slice(0, 5).map((o) => ({
                    id: o.officerId,
                    name: o.fullName,
                    sub: 'first linkage',
                    detail: formatRelative(o.firstLinkedAt),
                  }))}
                />
              </div>
              <p className="text-xs text-[#4A4A4A]/50 mt-4">
                Outlier thresholds are hardcoded for this PR; OWNER may tune them in a future PR. See the handover doc for the full list.
              </p>
            </details>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatTile({ label, value, tone }: {
  label: string;
  value: number | string;
  tone: 'navy' | 'gold' | 'blue' | 'emerald' | 'red';
}) {
  const tones = {
    navy: 'bg-[#1E3A5F]/5 text-[#1E3A5F]',
    gold: 'bg-[#E8B923]/20 text-[#1E3A5F]',
    blue: 'bg-blue-50 text-blue-800',
    emerald: 'bg-emerald-50 text-emerald-800',
    red: 'bg-red-50 text-red-800',
  };
  return (
    <div className={`rounded-xl p-4 ${tones[tone]}`}>
      <div className="text-2xl font-bold leading-none">{value}</div>
      <div className="text-xs font-semibold mt-1">{label}</div>
    </div>
  );
}

function OutlierCard({ title, icon, tone, rows }: {
  title: string;
  icon: React.ReactNode;
  tone: 'red' | 'amber' | 'emerald' | 'gold';
  rows: Array<{ id: string; name: string; sub: string; detail: string }>;
}) {
  const toneStyles = {
    red: 'border-red-200 bg-red-50/40',
    amber: 'border-amber-200 bg-amber-50/40',
    emerald: 'border-emerald-200 bg-emerald-50/40',
    gold: 'border-[#E8B923]/40 bg-[#E8B923]/10',
  };
  const iconTones = {
    red: 'text-red-700',
    amber: 'text-amber-700',
    emerald: 'text-emerald-700',
    gold: 'text-[#1E3A5F]',
  };
  return (
    <div className={`rounded-xl border ${toneStyles[tone]} p-4`}>
      <div className={`flex items-center gap-1.5 mb-2 ${iconTones[tone]}`}>
        {icon}
        <h3 className="text-xs font-bold uppercase tracking-wider">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-[#4A4A4A]/60 italic">None.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <Link href={`/lia/officers/${r.id}`} className="font-semibold text-[#1E3A5F] hover:text-[#E8B923] truncate block text-sm">
                  {r.name}
                </Link>
                <span className="text-[11px] text-[#4A4A4A]/60">{r.sub}</span>
              </div>
              <span className="text-[11px] font-semibold text-[#1E3A5F]/80 whitespace-nowrap">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
