import Link from 'next/link';
import { ArrowRight, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import {
  riskStyles, riskLabel, stageStyles, stageLabel, formatRelative, isEscalatedRisk,
} from '../_utils/format';

// PR-LIA-1 — Escalated cases queue.

interface CaseRow {
  id: string;
  stage: string;
  status: string;
  riskLevel: string;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  lead: {
    id: string;
    hardStopFlag: boolean;
    contact: { id: string; fullName: string | null; email: string | null } | null;
  };
  owner: { id: string; name: string } | null;
}

type SearchParams = {
  risk?: string;
  stage?: string;
};

export default async function LiaCasesPage({ searchParams }: { searchParams: SearchParams }) {
  const stageParam = searchParams.stage && searchParams.stage !== 'ALL' ? searchParams.stage : '';

  let cases: CaseRow[] = [];
  let errorMsg: string | null = null;
  try {
    const qs = stageParam ? `?stage=${stageParam}` : '';
    cases = await apiServer.get<CaseRow[]>(`/cases${qs}`);
  } catch (e) {
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load cases.';
  }

  const filtered = cases.filter(c => {
    switch (searchParams.risk) {
      case 'escalated': return isEscalatedRisk(c.riskLevel) || c.lead?.hardStopFlag;
      case 'high':      return c.riskLevel === 'HIGH';
      case 'medium':    return c.riskLevel === 'MEDIUM';
      case 'low':       return c.riskLevel === 'LOW';
      case 'blocked':   return c.riskLevel === 'BLOCKED' || c.lead?.hardStopFlag;
      default:          return true;
    }
  });

  const buildHref = (overrides: Partial<SearchParams>): string => {
    const merged: SearchParams = { ...searchParams, ...overrides };
    const next = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') next.set(k, String(v));
    });
    const s = next.toString();
    return s ? `/lia/cases?${s}` : '/lia/cases';
  };

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Cases</h1>
        <p className="text-sm text-[#4A4A4A]/70 mt-1">Cases requiring legal &amp; immigration review.</p>
      </div>

      <div className="space-y-3 mb-6">
        <ChipRow
          label="Risk"
          chips={[
            { label: 'All',       href: buildHref({ risk: '' }),         active: !searchParams.risk },
            { label: 'Escalated', href: buildHref({ risk: 'escalated' }), active: searchParams.risk === 'escalated' },
            { label: 'High',      href: buildHref({ risk: 'high' }),      active: searchParams.risk === 'high' },
            { label: 'Blocked',   href: buildHref({ risk: 'blocked' }),   active: searchParams.risk === 'blocked' },
            { label: 'Medium',    href: buildHref({ risk: 'medium' }),    active: searchParams.risk === 'medium' },
            { label: 'Low',       href: buildHref({ risk: 'low' }),       active: searchParams.risk === 'low' },
          ]}
        />
        <ChipRow
          label="Stage"
          chips={[
            { label: 'All',       href: buildHref({ stage: '' }),          active: !searchParams.stage },
            { label: 'Admission', href: buildHref({ stage: 'ADMISSION' }), active: searchParams.stage === 'ADMISSION' },
            { label: 'Visa',      href: buildHref({ stage: 'VISA' }),      active: searchParams.stage === 'VISA' },
          ]}
        />
      </div>

      {errorMsg && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg}</CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Search size={32} className="mx-auto text-[#1E3A5F]/30 mb-3" />
              <p className="text-[#4A4A4A] font-medium">No cases match these filters</p>
              <p className="text-sm text-[#4A4A4A]/60 mt-1">Try clearing some filters.</p>
            </div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#FAF8F3] text-[#4A4A4A]/70 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 text-left">Applicant</th>
                      <th className="px-4 py-3 text-left">Stage</th>
                      <th className="px-4 py-3 text-left">Risk</th>
                      <th className="px-4 py-3 text-left">Owner</th>
                      <th className="px-4 py-3 text-left">Created</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map(c => (
                      <tr key={c.id} className="hover:bg-[#FAF8F3]">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-[#1E3A5F]">{c.lead?.contact?.fullName ?? 'Unknown'}</div>
                          <div className="text-xs text-[#4A4A4A]/60 mt-0.5">Case {c.id.slice(0, 8)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${stageStyles(c.stage)}`}>
                            {stageLabel(c.stage)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${riskStyles(c.riskLevel)}`}>
                            {riskLabel(c.riskLevel)}
                          </span>
                          {c.lead?.hardStopFlag && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold bg-red-100 text-red-800 border border-red-200">
                              Hard stop
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[#4A4A4A]">
                          {c.owner?.name ?? <span className="text-[#4A4A4A]/50 italic">Unassigned</span>}
                        </td>
                        <td className="px-4 py-3 text-[#4A4A4A]/80 text-xs">{formatRelative(c.createdAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/lia/cases/${c.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F] hover:text-[#E8B923]">
                            Review <ArrowRight size={14} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="md:hidden divide-y divide-gray-100">
                {filtered.map(c => (
                  <li key={c.id} className="p-4 hover:bg-[#FAF8F3]">
                    <Link href={`/lia/cases/${c.id}`} className="block">
                      <div className="font-semibold text-[#1E3A5F]">{c.lead?.contact?.fullName ?? 'Unknown'}</div>
                      <div className="text-xs text-[#4A4A4A]/60 mt-0.5">Case {c.id.slice(0, 8)}</div>
                      <div className="flex items-center gap-2 flex-wrap mt-2 text-xs">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg font-semibold ${stageStyles(c.stage)}`}>{stageLabel(c.stage)}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg font-semibold ${riskStyles(c.riskLevel)}`}>{riskLabel(c.riskLevel)}</span>
                        {c.lead?.hardStopFlag && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg font-semibold bg-red-100 text-red-800 border border-red-200">Hard stop</span>
                        )}
                        <span className="text-[#4A4A4A]/60 ml-auto">{formatRelative(c.createdAt)}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChipRow({ label, chips }: { label: string; chips: { label: string; href: string; active: boolean }[] }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold text-[#4A4A4A]/70 w-16 flex-shrink-0">{label}</span>
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
