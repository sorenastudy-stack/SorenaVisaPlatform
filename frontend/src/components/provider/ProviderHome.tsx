'use client';

import { GraduationCap, Coins, Award } from 'lucide-react';
import { useProviderMe } from './ProviderShell';
import { ProviderMarketingAssets } from './ProviderMarketingAssets';
import { Card, CardContent } from '@/components/ui/Card';

// PR-PROVIDER-PORTAL slice C — what an institution sees when they sign in.
//
// The counts are here for one reason: after an upload, "how much do you hold for
// us?" is the obvious next question, and a number the institution can check
// against their own spreadsheet is how they find out we dropped half a file.
//
// The counts are TOTALS, not "live to students" — a count that quietly excluded
// rows awaiting review would read as data loss.
//
// The spreadsheet uploads used to live here. They moved to the sections they
// act on: the programme sheet sits with the programme form, the fee and
// scholarship sheets sit with the pricing tools. This page is now what an
// institution IS — its profile, its numbers, and the material it sends us.

export function ProviderHome() {
  const me = useProviderMe();
  if (!me) return null;

  const stats = [
    { label: 'Programmes', value: me.counts.programmes, icon: <GraduationCap size={16} /> },
    { label: 'Fee rows', value: me.counts.tuitions, icon: <Coins size={16} /> },
    { label: 'Scholarships', value: me.counts.scholarships, icon: <Award size={16} /> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-sorena-navy">{me.name}</h1>
        <p className="mt-1 text-sm text-sorena-text/60">
          {[me.city, me.country].filter(Boolean).join(', ') || 'Institution profile'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {s.icon} {s.label}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-sorena-navy">{s.value}</p>
              {/* An empty state that says what to do, rather than a bare zero. */}
              {s.value === 0 && (
                <p className="mt-1 text-xs text-gray-500">
              {s.label === 'Programmes' ? 'Nothing yet — add them under Programmes.' : 'Nothing yet — add these under Country groups.'}
            </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <ProviderMarketingAssets />
    </div>
  );
}
