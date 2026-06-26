import Link from 'next/link';
import { Link2, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { CreateLinkButton } from '@/components/staff/marketing/CreateLinkButton';
import { CopyShortUrl } from '@/components/staff/marketing/CopyShortUrl';

// PR-SCORECARD-2 — Tracking links list.

interface LinkRow {
  id: string;
  shortCode: string;
  shortUrl: string;
  channel: string;
  agentId: string | null;
  agentName: string | null;
  campaignLabel: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  clickCount: number;
  attributedLeadCount: number;
  conversionRate: number;
  createdAt: string;
}

interface AgentMini {
  id: string;
  fullName: string;
}

type SearchParams = { channel?: string; agentId?: string; status?: string };

export default async function LinksListPage({
  searchParams,
}: { searchParams: SearchParams }) {
  let links: LinkRow[] = [];
  let agents: AgentMini[] = [];
  let errorMsg: string | null = null;
  try {
    const qs = new URLSearchParams();
    if (searchParams.channel) qs.set('channel', searchParams.channel);
    if (searchParams.agentId) qs.set('agentId', searchParams.agentId);
    if (searchParams.status)  qs.set('status', searchParams.status);
    const tail = qs.toString();
    [links, agents] = await Promise.all([
      apiServer.get<LinkRow[]>(`/staff/marketing/links${tail ? `?${tail}` : ''}`),
      apiServer.get<AgentMini[]>('/staff/marketing/agents?status=ACTIVE'),
    ]);
  } catch (e) {
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load links.';
  }

  return (
    <div className="max-w-6xl">
      <Link href="/staff/marketing" className="inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#b8941f] mb-4">
        ← Back to marketing
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <Link2 size={22} className="text-[#b8941f]" />
            Tracking links
            <span className="text-sm font-medium text-[#4A4A4A]/60 ml-1">{links.length}</span>
          </h1>
          <p className="text-sm text-[#4A4A4A]/70 mt-1">
            Per-channel short URLs that funnel clicks into the scorecard funnel.
          </p>
        </div>
        <CreateLinkButton agents={agents} />
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-4 text-sm">
        <span className="text-xs font-semibold text-[#4A4A4A]/70 w-20 flex-shrink-0">Status</span>
        <FilterChip label="All"      href="/staff/marketing/links"              active={!searchParams.status} />
        <FilterChip label="Active"   href="/staff/marketing/links?status=ACTIVE" active={searchParams.status === 'ACTIVE'} />
        <FilterChip label="Archived" href="/staff/marketing/links?status=ARCHIVED" active={searchParams.status === 'ARCHIVED'} />
      </div>

      {errorMsg && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg}</CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {links.length === 0 ? (
            <div className="py-12 text-center">
              <Link2 size={28} className="mx-auto text-[#1E3A5F]/30 mb-3" />
              <p className="text-[#4A4A4A] font-medium">No tracking links yet</p>
              <p className="text-sm text-[#4A4A4A]/60 mt-1">Create your first link to start tracking clicks → submissions.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#FAF8F3] text-[#4A4A4A]/70 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">Short code</th>
                    <th className="px-4 py-3 text-left">Channel</th>
                    <th className="px-4 py-3 text-left">Agent</th>
                    <th className="px-4 py-3 text-left">Campaign</th>
                    <th className="px-4 py-3 text-left">Clicks</th>
                    <th className="px-4 py-3 text-left">Submissions</th>
                    <th className="px-4 py-3 text-left">Conv. %</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {links.map((r) => (
                    <tr key={r.id} className="hover:bg-[#FAF8F3]">
                      <td className="px-4 py-3 font-mono font-semibold text-[#1E3A5F]">
                        <CopyShortUrl shortUrl={r.shortUrl} shortCode={r.shortCode} />
                      </td>
                      <td className="px-4 py-3 text-xs text-[#4A4A4A]">{r.channel}</td>
                      <td className="px-4 py-3 text-[#4A4A4A]">
                        {r.agentName ?? <span className="text-[#4A4A4A]/40">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[#4A4A4A] truncate max-w-[180px]">
                        {r.campaignLabel ?? <span className="text-[#4A4A4A]/40">—</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-[#1E3A5F]">{r.clickCount}</td>
                      <td className="px-4 py-3 font-mono text-[#1E3A5F]">{r.attributedLeadCount}</td>
                      <td className="px-4 py-3 font-mono text-[#4A4A4A]">
                        {(r.conversionRate * 100).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold border ${
                          r.status === 'ACTIVE'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'bg-gray-100 text-gray-700 border-gray-200'
                        }`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/staff/marketing/links/${r.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F] hover:text-[#b8941f]">
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
