'use client';

import { useEffect, useState } from 'react';
import { Loader2, Clock3, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-PROVIDER-PORTAL slice F — the institution's own numbers.
//
// Deliberately plain. These counts will read 0 for a while in production, and a
// dashboard of charts drawn over zeros looks like something is broken rather
// than something is new. A table that says "nobody has been shown this yet" is
// the honest version.
//
// Two columns, no third. There is no comparison to other institutions anywhere
// in the payload — see the endpoint.

interface Row {
  id: string;
  name: string;
  level: string;
  campusCity: string | null;
  isActive: boolean;
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  recommended: number;
  chosen: number;
}
interface Overview {
  programmes: Row[];
  totals: { programmes: number; recommended: number; chosen: number };
}

const LEVEL_LABEL: Record<string, string> = {
  CERTIFICATE: 'Certificate', DIPLOMA: 'Diploma', GRADUATE_CERTIFICATE: 'Graduate certificate',
  GRADUATE_DIPLOMA: 'Graduate diploma', BACHELOR: 'Bachelor’s', POSTGRADUATE_CERTIFICATE: 'Postgraduate certificate',
  POSTGRADUATE_DIPLOMA: 'Postgraduate diploma', MASTER: 'Master’s', PHD: 'Doctorate',
};

export function ProviderAnalytics() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Overview>('/provider/analytics')
      .then(setData)
      .catch((e) => setError(e?.message ?? 'Couldn’t load your figures.'));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <div className="flex items-center gap-2 py-16 text-sorena-text/60"><Loader2 size={18} className="animate-spin" /> Loading…</div>;

  const nothingYet = data.totals.recommended === 0 && data.totals.chosen === 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-sorena-navy">How your programmes are doing</h1>
        <p className="mt-0.5 max-w-xl text-sm text-sorena-text/60">
          How often each of your programmes has been suggested to a student, and how often a student
          then chose it on an application.
        </p>
      </div>

      {data.programmes.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <p className="text-sm font-semibold text-sorena-navy">No programmes yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">
            Once you’ve added programmes, this is where you’ll see how they’re doing.
          </p>
        </CardContent></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Programmes" value={data.totals.programmes} />
            <Stat label="Times suggested" value={data.totals.recommended} />
            <Stat label="Times chosen" value={data.totals.chosen} />
          </div>

          {/* Said once, at the top, rather than repeated as "0" on every row. */}
          {nothingYet && (
            <p className="rounded-xl border border-[#c9a961]/40 bg-[#faf8f3] px-4 py-3 text-xs leading-relaxed text-gray-700">
              Nothing to show yet — these numbers start moving once students are matched to your
              programmes. A programme that’s still with us for review, or that you’ve stopped
              offering, won’t be suggested to anyone.
            </p>
          )}

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left">
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Programme</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Suggested</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Chosen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.programmes.map((r) => (
                      <tr key={r.id} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-sorena-navy">{r.name}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
                            <span>{LEVEL_LABEL[r.level] ?? r.level}{r.campusCity ? ` · ${r.campusCity}` : ''}</span>
                            {/* A zero next to "with us for review" means something
                                different from a zero next to a live programme. */}
                            {!r.isActive && (
                              <span className="inline-flex items-center gap-1 text-gray-400">
                                <EyeOff size={11} /> not being offered
                              </span>
                            )}
                            {r.isActive && r.reviewStatus !== 'APPROVED' && (
                              <span className="inline-flex items-center gap-1 text-[#8a6d10]">
                                <Clock3 size={11} /> with us for review
                              </span>
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-sorena-navy">{r.recommended}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-sorena-navy">{r.chosen}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-sorena-navy">{value}</p>
      </CardContent>
    </Card>
  );
}
