import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Users, Mail, Phone, Link2, ArrowRight, FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { AgentActions } from '@/components/staff/marketing/AgentActions';

// PR-SCORECARD-2 — Affiliate agent detail.

interface AgentDetail {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'TERMINATED';
  notes: string | null;
  activeLinkCount: number;
  totalLeadCount: number;
  links: Array<{
    id: string;
    shortCode: string;
    channel: string;
    status: string;
    campaignLabel: string | null;
    clickCount: number;
    createdAt: string;
  }>;
  bandDistribution: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export default async function AgentDetailPage({ params }: { params: { id: string } }) {
  let data: AgentDetail | null = null;
  let errorMsg: string | null = null;
  try {
    data = await apiServer.get<AgentDetail>(`/staff/marketing/agents/${params.id}`);
  } catch (e) {
    if (e instanceof ApiServerError && e.statusCode === 404) notFound();
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load agent.';
  }
  if (!data) {
    return (
      <div className="max-w-3xl">
        <Link href="/staff/marketing/agents" className="text-sm text-[#1E3A5F]">← Back to agents</Link>
        <Card className="mt-4 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg ?? 'Unavailable.'}</CardContent>
        </Card>
      </div>
    );
  }

  const totalAttributed = Object.values(data.bandDistribution).reduce((a, b) => a + b, 0);

  return (
    <div className="max-w-5xl">
      <Link href="/staff/marketing/agents" className="inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#b8941f] mb-4">
        ← Back to agents
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <Users size={22} className="text-[#b8941f]" />
            {data.fullName}
          </h1>
          <div className="mt-2 flex items-center gap-3 text-sm text-[#4A4A4A]/80 flex-wrap">
            {data.email && (
              <span className="inline-flex items-center gap-1"><Mail size={12} /> {data.email}</span>
            )}
            {data.phone && (
              <span className="inline-flex items-center gap-1"><Phone size={12} /> {data.phone}</span>
            )}
          </div>
        </div>
        <AgentActions agentId={data.id} status={data.status} fullName={data.fullName} hasActiveLinks={data.activeLinkCount > 0} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Active links"  value={data.activeLinkCount} />
        <Stat label="Total leads"   value={data.totalLeadCount} />
        <Stat label="Attributed scorecards" value={totalAttributed} />
      </div>

      {/* Band distribution */}
      <Card className="mb-6">
        <CardContent>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-3">
            Band distribution
          </h2>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {Object.entries(data.bandDistribution).map(([band, count]) => (
              <div key={band} className="text-center rounded-xl border border-gray-100 bg-[#FAF8F3] p-3">
                <div className="text-xs font-semibold text-[#4A4A4A]/70">{band.replace('BAND_', 'Band ')}</div>
                <div className="text-xl font-extrabold text-[#1E3A5F] mt-1">{count}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tracking links */}
      <Card className="mb-6">
        <CardContent>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-3 flex items-center gap-2">
            <Link2 size={14} /> Tracking links
          </h2>
          {data.links.length === 0 ? (
            <p className="text-sm text-[#4A4A4A]/60 italic">No tracking links yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.links.map((l) => (
                <li key={l.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-[#1E3A5F] font-semibold">{l.shortCode}</code>
                      <span className="text-xs text-[#4A4A4A]/70">{l.channel}</span>
                      {l.status === 'ARCHIVED' && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">archived</span>
                      )}
                    </div>
                    {l.campaignLabel && (
                      <div className="text-xs text-[#4A4A4A]/60 truncate">{l.campaignLabel}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <span className="text-xs text-[#4A4A4A]/70">{l.clickCount} clicks</span>
                    <Link href={`/staff/marketing/links/${l.id}`} className="text-[#1E3A5F] hover:text-[#b8941f]">
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {data.notes && (
        <Card>
          <CardContent>
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-2 flex items-center gap-2">
              <FileText size={14} /> Notes
            </h2>
            <p className="text-sm text-[#4A4A4A] whitespace-pre-wrap">{data.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent>
        <div className="text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60">{label}</div>
        <div className="text-2xl font-extrabold text-[#1E3A5F] mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
