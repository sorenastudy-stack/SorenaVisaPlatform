'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-SCORECARD-2 — Per-link stats panel.
//
// Window toggle (30/60/90 days) re-fetches GET /staff/marketing/links/:id/stats?windowDays=N.

interface Stats {
  linkId: string;
  shortCode: string;
  channel: string;
  agentName: string | null;
  campaignLabel: string | null;
  clicks: number;
  signups: number;
  scorecardCompletions: number;
  bandDistribution: Record<string, number>;
  windowDays: number;
}

export function LinkStatsBlock({
  linkId, initialWindowDays,
}: { linkId: string; initialWindowDays: number }) {
  const [windowDays, setWindowDays] = useState(initialWindowDays);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<Stats>(`/staff/marketing/links/${linkId}/stats?windowDays=${windowDays}`);
        if (!cancelled) setStats(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load stats.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [linkId, windowDays]);

  const bandData = stats
    ? Object.entries(stats.bandDistribution).map(([band, count]) => ({
        band: band.replace('BAND_', 'B'),
        count,
      }))
    : [];

  const conversion = stats && stats.clicks > 0
    ? (stats.scorecardCompletions / stats.clicks) * 100
    : 0;

  return (
    <Card className="mb-6">
      <CardContent>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60">
            Stats — last {windowDays} day{windowDays === 1 ? '' : 's'}
          </h2>
          <div className="flex items-center gap-1.5">
            {[30, 60, 90].map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWindowDays(w)}
                className={`inline-flex items-center px-3 py-1 rounded-lg text-xs font-semibold border ${
                  windowDays === w
                    ? 'bg-[#1E3A5F] text-white border-[#1E3A5F]'
                    : 'bg-white text-[#4A4A4A] border-gray-200 hover:border-[#1E3A5F] hover:text-[#1E3A5F]'
                }`}
              >
                {w}d
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-700 mb-3">{error}</div>
        )}

        {loading ? (
          <div className="py-8 text-center text-[#4A4A4A]/60 inline-flex items-center gap-2 justify-center w-full">
            <Loader2 size={14} className="animate-spin" /> Loading stats…
          </div>
        ) : stats ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <StatTile label="Clicks"        value={stats.clicks} />
              <StatTile label="Signups"       value={stats.signups} />
              <StatTile label="Submissions"   value={stats.scorecardCompletions} />
              <StatTile label="Conversion"    value={`${conversion.toFixed(1)}%`} />
            </div>

            <div className="rounded-xl border border-gray-100 bg-[#FAF8F3] p-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60 mb-2">
                Band distribution
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={bandData}>
                  <XAxis dataKey="band" stroke="#4A4A4A" fontSize={11} />
                  <YAxis stroke="#4A4A4A" fontSize={11} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'rgba(232,185,35,0.1)' }} />
                  <Bar dataKey="count" fill="#1E3A5F" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-[#FAF8F3] p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60">{label}</div>
      <div className="text-2xl font-extrabold text-[#1E3A5F] mt-1">{value}</div>
    </div>
  );
}
