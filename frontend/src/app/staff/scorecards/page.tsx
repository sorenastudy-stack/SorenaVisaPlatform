import Link from 'next/link';
import { ClipboardList, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { apiServer, ApiServerError } from '@/lib/apiServer';

// PR-SCORECARD-1 — Staff scorecard list view.
//
// Server component. Backend role gate is OWNER/ADMIN/SUPER_ADMIN/
// CONSULTANT; the existing /staff/layout.tsx already enforces this
// (it permits all 7 staff roles — the backend rejects the others,
// which is fine).

interface ScorecardRow {
  id: string;
  submittedAt: string;
  applicantName: string | null;
  band: 'BAND_1' | 'BAND_2' | 'BAND_3' | 'BAND_4' | 'BAND_5' | 'BAND_6';
  totalScore: number;
  executionEligible: boolean;
  hardStopCount: number;
  leadId: string | null;
}

type SearchParams = {
  band?: string;
  eligible?: string;
};

export default async function ScorecardsListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  let rows: ScorecardRow[] = [];
  let errorMsg: string | null = null;
  try {
    rows = await apiServer.get<ScorecardRow[]>('/staff/scorecards');
  } catch (e) {
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load scorecards.';
  }

  // Client-side filter (server returns the latest 200 — small enough)
  const filtered = rows.filter((r) => {
    if (searchParams.band && searchParams.band !== 'ALL' && `BAND_${searchParams.band}` !== r.band) return false;
    if (searchParams.eligible === 'yes' && !r.executionEligible) return false;
    if (searchParams.eligible === 'no' && r.executionEligible) return false;
    return true;
  });

  return (
    <div className="max-w-7xl">
      <Link href="/staff" className="inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#b8941f] mb-4">
        ← Back to staff
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <ClipboardList size={22} className="text-[#b8941f]" />
          Scorecard Submissions
          <span className="text-sm font-medium text-[#4A4A4A]/60 ml-1">{filtered.length}</span>
        </h1>
        <p className="text-sm text-[#4A4A4A]/70 mt-1">
          Readiness Assessment submissions. Sorted newest first.
        </p>
      </div>

      <div className="space-y-3 mb-6">
        <ChipRow label="Band" chips={[
          { label: 'All',  href: '/staff/scorecards', active: !searchParams.band || searchParams.band === 'ALL' },
          { label: 'Band 1', href: '/staff/scorecards?band=1', active: searchParams.band === '1' },
          { label: 'Band 2', href: '/staff/scorecards?band=2', active: searchParams.band === '2' },
          { label: 'Band 3', href: '/staff/scorecards?band=3', active: searchParams.band === '3' },
          { label: 'Band 4', href: '/staff/scorecards?band=4', active: searchParams.band === '4' },
          { label: 'Band 5', href: '/staff/scorecards?band=5', active: searchParams.band === '5' },
          { label: 'Band 6', href: '/staff/scorecards?band=6', active: searchParams.band === '6' },
        ]} />
        <ChipRow label="Eligible" chips={[
          { label: 'All', href: linkWith(searchParams, 'eligible', ''), active: !searchParams.eligible },
          { label: 'Yes', href: linkWith(searchParams, 'eligible', 'yes'), active: searchParams.eligible === 'yes' },
          { label: 'No',  href: linkWith(searchParams, 'eligible', 'no'),  active: searchParams.eligible === 'no' },
        ]} />
      </div>

      {errorMsg && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg}</CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-12 text-center">
              <ClipboardList size={32} className="mx-auto text-[#1E3A5F]/30 mb-3" />
              <p className="text-[#4A4A4A] font-medium">No submissions match these filters</p>
              <p className="text-sm text-[#4A4A4A]/60 mt-1">Submissions will appear here as leads complete the assessment.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#FAF8F3] text-[#4A4A4A]/70 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">Submitted</th>
                    <th className="px-4 py-3 text-left">Applicant</th>
                    <th className="px-4 py-3 text-left">Band</th>
                    <th className="px-4 py-3 text-left">Total</th>
                    <th className="px-4 py-3 text-left">Execution</th>
                    <th className="px-4 py-3 text-left">Hard stops</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((r) => (
                    <tr key={r.id} className="hover:bg-[#FAF8F3]">
                      <td className="px-4 py-3 text-xs text-[#4A4A4A]/70">{formatDateTime(r.submittedAt)}</td>
                      <td className="px-4 py-3 font-semibold text-[#1E3A5F]">{r.applicantName ?? '(unknown)'}</td>
                      <td className="px-4 py-3"><BandBadge band={r.band} /></td>
                      <td className="px-4 py-3 font-mono text-[#1E3A5F]">{r.totalScore}/100</td>
                      <td className="px-4 py-3">
                        {r.executionEligible
                          ? <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-semibold"><CheckCircle2 size={12} /> Eligible</span>
                          : <span className="inline-flex items-center gap-1 text-gray-500 text-xs font-semibold"><XCircle size={12} /> Not yet</span>}
                      </td>
                      <td className="px-4 py-3">
                        {r.hardStopCount > 0
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-red-100 text-red-800 border border-red-200">{r.hardStopCount}</span>
                          : <span className="text-xs text-[#4A4A4A]/60">0</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/staff/scorecards/${r.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F] hover:text-[#b8941f]">
                          View <ArrowRight size={12} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function linkWith(search: SearchParams, key: keyof SearchParams, value: string): string {
  const params = new URLSearchParams();
  if (search.band) params.set('band', search.band);
  if (search.eligible) params.set('eligible', search.eligible);
  if (value) params.set(key, value); else params.delete(key);
  const s = params.toString();
  return s ? `/staff/scorecards?${s}` : '/staff/scorecards';
}

function ChipRow({ label, chips }: { label: string; chips: { label: string; href: string; active: boolean }[] }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold text-[#4A4A4A]/70 w-24 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {chips.map(c => (
          <Link
            key={c.label + c.href}
            href={c.href}
            className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              c.active
                ? 'bg-[#1E3A5F] text-white'
                : 'bg-white text-[#4A4A4A] border border-gray-200 hover:border-[#1E3A5F] hover:text-[#1E3A5F]'
            }`}
          >
            {c.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function BandBadge({ band }: { band: ScorecardRow['band'] }) {
  const styles: Record<ScorecardRow['band'], string> = {
    BAND_1: 'bg-gray-100 text-gray-700 border border-gray-200',
    BAND_2: 'bg-blue-50 text-blue-800 border border-blue-200',
    BAND_3: 'bg-amber-50 text-amber-800 border border-amber-200',
    BAND_4: 'bg-orange-50 text-orange-800 border border-orange-200',
    BAND_5: 'bg-violet-50 text-violet-800 border border-violet-200',
    BAND_6: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold ${styles[band]}`}>
      {band.replace('BAND_', 'Band ')}
    </span>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-NZ', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}
