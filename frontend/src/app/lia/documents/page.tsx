import Link from 'next/link';
import { ArrowRight, FileSearch } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { BackLink } from '@/components/ui/BackLink';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import {
  riskStyles, riskLabel, docStatusStyles, formatRelative, isEscalatedRisk,
} from '../_utils/format';

// PR-LIA-1 — Documents view across escalated cases. The LIA cares
// about documents on cases flagged HIGH / BLOCKED or hard-stopped.
// Action button is "Open case", never a raw file URL — see security
// note in the handover doc.

interface CaseRow {
  id: string;
  riskLevel: string;
  lead: {
    hardStopFlag: boolean;
    contact: { fullName: string | null } | null;
  };
  owner: { name: string } | null;
}

interface CaseDetail {
  id: string;
  riskLevel: string;
  applications: Array<{
    id: string;
    documents: Array<{
      id: string;
      type: string;
      status: string;
      createdAt: string;
      updatedAt: string;
    }>;
  }>;
}

interface DocRow {
  docId: string;
  caseId: string;
  type: string;
  status: string;
  riskLevel: string;
  updatedAt: string;
  contactName: string;
  ownerName: string | null;
  hardStop: boolean;
}

type SearchParams = { status?: string; risk?: string };

export default async function LiaDocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  let cases: CaseRow[] = [];
  let errorMsg: string | null = null;

  try {
    cases = await apiServer.get<CaseRow[]>('/cases');
  } catch (e) {
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load cases.';
  }

  const escalated = cases.filter(c => isEscalatedRisk(c.riskLevel) || c.lead?.hardStopFlag);

  const allDocs: DocRow[] = [];
  for (const c of escalated) {
    try {
      const detail = await apiServer.get<CaseDetail>(`/cases/${c.id}`);
      for (const app of detail.applications) {
        for (const d of app.documents) {
          allDocs.push({
            docId: d.id,
            caseId: c.id,
            type: d.type,
            status: d.status,
            riskLevel: detail.riskLevel,
            updatedAt: d.updatedAt,
            contactName: c.lead?.contact?.fullName ?? 'Unknown',
            ownerName: c.owner?.name ?? null,
            hardStop: c.lead?.hardStopFlag ?? false,
          });
        }
      }
    } catch {
      // Skip cases we can't read.
    }
  }
  allDocs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const statusFilter = (searchParams.status ?? 'ALL').toUpperCase();
  const riskFilter = (searchParams.risk ?? 'ALL').toUpperCase();
  const filtered = allDocs.filter(d => {
    if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;
    if (riskFilter === 'HIGH' && d.riskLevel !== 'HIGH') return false;
    if (riskFilter === 'BLOCKED' && d.riskLevel !== 'BLOCKED' && !d.hardStop) return false;
    return true;
  });

  const summary = {
    total: allDocs.length,
    missing: allDocs.filter(d => d.status === 'MISSING').length,
    pending: allDocs.filter(d => d.status === 'PENDING').length,
    approved: allDocs.filter(d => d.status === 'APPROVED').length,
    rejected: allDocs.filter(d => d.status === 'REJECTED').length,
  };

  const buildHref = (overrides: Partial<SearchParams>): string => {
    const merged: SearchParams = { ...searchParams, ...overrides };
    const next = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (v && v !== 'ALL') next.set(k, String(v));
    });
    const s = next.toString();
    return s ? `/lia/documents?${s}` : '/lia/documents';
  };

  return (
    <div className="max-w-7xl">
      <BackLink href="/lia" label="Back to dashboard" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Documents under review</h1>
        <p className="text-sm text-[#4A4A4A]/70 mt-1">Documents on escalated cases — HIGH risk, BLOCKED, or hard-stopped.</p>
      </div>

      <Card className="mb-6">
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Tile label="Total" value={summary.total} tone="gray" />
            <Tile label="Missing" value={summary.missing} tone="gray" />
            <Tile label="Pending" value={summary.pending} tone="amber" />
            <Tile label="Approved" value={summary.approved} tone="emerald" />
            <Tile label="Rejected" value={summary.rejected} tone="red" />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3 mb-6">
        <ChipRow
          label="Status"
          chips={[
            { label: 'All',      href: buildHref({ status: 'ALL' }),      active: statusFilter === 'ALL' },
            { label: 'Pending',  href: buildHref({ status: 'PENDING' }),  active: statusFilter === 'PENDING' },
            { label: 'Approved', href: buildHref({ status: 'APPROVED' }), active: statusFilter === 'APPROVED' },
            { label: 'Rejected', href: buildHref({ status: 'REJECTED' }), active: statusFilter === 'REJECTED' },
            { label: 'Missing',  href: buildHref({ status: 'MISSING' }),  active: statusFilter === 'MISSING' },
          ]}
        />
        <ChipRow
          label="Risk"
          chips={[
            { label: 'All',     href: buildHref({ risk: 'ALL' }),     active: riskFilter === 'ALL' },
            { label: 'High',    href: buildHref({ risk: 'HIGH' }),    active: riskFilter === 'HIGH' },
            { label: 'Blocked', href: buildHref({ risk: 'BLOCKED' }), active: riskFilter === 'BLOCKED' },
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
              <FileSearch size={32} className="mx-auto text-[#1E3A5F]/30 mb-3" />
              <p className="text-[#4A4A4A] font-medium">No documents match these filters</p>
              <p className="text-sm text-[#4A4A4A]/60 mt-1">Try clearing some filters.</p>
            </div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#FAF8F3] text-[#4A4A4A]/70 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Applicant</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-left">Risk</th>
                      <th className="px-4 py-3 text-left">Owner</th>
                      <th className="px-4 py-3 text-left">Updated</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map(d => (
                      <tr key={d.docId} className="hover:bg-[#FAF8F3]">
                        <td className="px-4 py-3 font-semibold text-[#1E3A5F]">{d.type}</td>
                        <td className="px-4 py-3 text-[#4A4A4A]">{d.contactName}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${docStatusStyles(d.status)}`}>
                            {d.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${riskStyles(d.riskLevel)}`}>
                            {riskLabel(d.riskLevel)}
                          </span>
                          {d.hardStop && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold bg-red-100 text-red-800 border border-red-200">
                              Hard stop
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[#4A4A4A]">
                          {d.ownerName ?? <span className="text-[#4A4A4A]/50 italic">Unassigned</span>}
                        </td>
                        <td className="px-4 py-3 text-[#4A4A4A]/80 text-xs">{formatRelative(d.updatedAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/lia/cases/${d.caseId}`} className="inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F] hover:text-[#b8941f]">
                            Open case <ArrowRight size={14} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="md:hidden divide-y divide-gray-100">
                {filtered.map(d => (
                  <li key={d.docId} className="p-4 hover:bg-[#FAF8F3]">
                    <Link href={`/lia/cases/${d.caseId}`} className="block">
                      <div className="font-semibold text-[#1E3A5F]">{d.type}</div>
                      <div className="text-xs text-[#4A4A4A]/60 mt-0.5">{d.contactName}</div>
                      <div className="flex items-center gap-2 flex-wrap mt-2 text-xs">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg font-semibold ${docStatusStyles(d.status)}`}>
                          {d.status}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg font-semibold ${riskStyles(d.riskLevel)}`}>
                          {riskLabel(d.riskLevel)}
                        </span>
                        {d.hardStop && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg font-semibold bg-red-100 text-red-800 border border-red-200">Hard stop</span>
                        )}
                        <span className="text-[#4A4A4A]/60 ml-auto">{formatRelative(d.updatedAt)}</span>
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

function Tile({ label, value, tone }: {
  label: string; value: number; tone: 'gray' | 'amber' | 'emerald' | 'red';
}) {
  const tones = {
    gray:    'bg-gray-50 text-gray-700',
    amber:   'bg-amber-50 text-amber-800',
    emerald: 'bg-emerald-50 text-emerald-800',
    red:     'bg-red-50 text-red-800',
  };
  return (
    <div className={`rounded-xl p-4 ${tones[tone]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs font-medium mt-0.5">{label}</div>
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
