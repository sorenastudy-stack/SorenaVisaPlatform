import Link from 'next/link';
import { Users, ArrowRight, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { CreateAgentButton } from '@/components/staff/marketing/CreateAgentButton';

// PR-SCORECARD-2 — Affiliate agents list.

interface AgentRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'TERMINATED';
  activeLinkCount: number;
  totalLeadCount: number;
  createdAt: string;
}

type SearchParams = { status?: string; q?: string };

export default async function AgentsListPage({
  searchParams,
}: { searchParams: SearchParams }) {
  let rows: AgentRow[] = [];
  let errorMsg: string | null = null;
  try {
    const qs = new URLSearchParams();
    if (searchParams.status) qs.set('status', searchParams.status);
    if (searchParams.q)      qs.set('search', searchParams.q);
    const tail = qs.toString();
    rows = await apiServer.get<AgentRow[]>(`/staff/marketing/agents${tail ? `?${tail}` : ''}`);
  } catch (e) {
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load agents.';
  }

  return (
    <div className="max-w-5xl">
      <Link href="/staff/marketing" className="inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#E8B923] mb-4">
        ← Back to marketing
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <Users size={22} className="text-[#E8B923]" />
            Affiliate agents
            <span className="text-sm font-medium text-[#4A4A4A]/60 ml-1">{rows.length}</span>
          </h1>
          <p className="text-sm text-[#4A4A4A]/70 mt-1">
            People (or accounts) who refer leads. Commission math comes in a future PR.
          </p>
        </div>
        <CreateAgentButton />
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-4 text-sm">
        <span className="text-xs font-semibold text-[#4A4A4A]/70 w-20 flex-shrink-0">Status</span>
        <FilterChip label="All"        href="/staff/marketing/agents"               active={!searchParams.status} />
        <FilterChip label="Active"     href="/staff/marketing/agents?status=ACTIVE"  active={searchParams.status === 'ACTIVE'} />
        <FilterChip label="Paused"     href="/staff/marketing/agents?status=PAUSED"  active={searchParams.status === 'PAUSED'} />
        <FilterChip label="Terminated" href="/staff/marketing/agents?status=TERMINATED" active={searchParams.status === 'TERMINATED'} />
      </div>

      {errorMsg && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg}</CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-12 text-center">
              <Users size={28} className="mx-auto text-[#1E3A5F]/30 mb-3" />
              <p className="text-[#4A4A4A] font-medium">No agents yet</p>
              <p className="text-sm text-[#4A4A4A]/60 mt-1">Add an affiliate agent to start tracking referrals.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#FAF8F3] text-[#4A4A4A]/70 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Email</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Active links</th>
                    <th className="px-4 py-3 text-left">Total leads</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-[#FAF8F3]">
                      <td className="px-4 py-3 font-semibold text-[#1E3A5F]">{r.fullName}</td>
                      <td className="px-4 py-3 text-[#4A4A4A] truncate max-w-[200px]">{r.email ?? '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-3 font-mono text-[#1E3A5F]">{r.activeLinkCount}</td>
                      <td className="px-4 py-3 font-mono text-[#1E3A5F]">{r.totalLeadCount}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/staff/marketing/agents/${r.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F] hover:text-[#E8B923]">
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

function FilterChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
        active
          ? 'bg-[#1E3A5F] text-white'
          : 'bg-white text-[#4A4A4A] border border-gray-200 hover:border-[#1E3A5F] hover:text-[#1E3A5F]'
      }`}
    >
      {label}
    </Link>
  );
}

function StatusBadge({ status }: { status: AgentRow['status'] }) {
  const styles = {
    ACTIVE:     'bg-emerald-100 text-emerald-800 border-emerald-200',
    PAUSED:     'bg-amber-100   text-amber-800   border-amber-200',
    TERMINATED: 'bg-gray-100    text-gray-700    border-gray-200',
  }[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold border ${styles}`}>
      {status}
    </span>
  );
}
