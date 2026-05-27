import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Link2, Calendar, Hash, Users, Archive } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { CopyShortUrl } from '@/components/staff/marketing/CopyShortUrl';
import { ArchiveLinkButton } from '@/components/staff/marketing/ArchiveLinkButton';
import { LinkStatsBlock } from '@/components/staff/marketing/LinkStatsBlock';

// PR-SCORECARD-2 — Tracking link detail.

interface LinkDetail {
  id: string;
  shortCode: string;
  shortUrl: string;
  channel: string;
  agentId: string | null;
  agentName: string | null;
  campaignLabel: string | null;
  destination: string;
  status: 'ACTIVE' | 'ARCHIVED';
  clickCount: number;
  attributedLeadCount: number;
  conversionRate: number;
  createdAt: string;
  archivedAt: string | null;
}

export default async function LinkDetailPage({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { windowDays?: string };
}) {
  let data: LinkDetail | null = null;
  let errorMsg: string | null = null;
  try {
    data = await apiServer.get<LinkDetail>(`/staff/marketing/links/${params.id}`);
  } catch (e) {
    if (e instanceof ApiServerError && e.statusCode === 404) notFound();
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load link.';
  }
  if (!data) {
    return (
      <div className="max-w-3xl">
        <Link href="/staff/marketing/links" className="text-sm text-[#1E3A5F]">← Back to links</Link>
        <Card className="mt-4 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg ?? 'Unavailable.'}</CardContent>
        </Card>
      </div>
    );
  }

  const windowDays = Math.max(1, parseInt(searchParams.windowDays ?? '30', 10) || 30);

  return (
    <div className="max-w-5xl">
      <Link href="/staff/marketing/links" className="inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#E8B923] mb-4">
        ← Back to links
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <Link2 size={22} className="text-[#E8B923]" />
            <CopyShortUrl shortUrl={data.shortUrl} shortCode={data.shortCode} />
            <span className="text-sm font-medium text-[#4A4A4A]/70">{data.channel}</span>
            {data.status === 'ARCHIVED' && (
              <span className="text-xs px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700">archived</span>
            )}
          </h1>
          <p className="text-sm text-[#4A4A4A]/70 mt-1 break-all">{data.shortUrl}</p>
        </div>
        {data.status === 'ACTIVE' && (
          <ArchiveLinkButton linkId={data.id} />
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <MetaRow icon={<Calendar size={14} />} label="Created" value={new Date(data.createdAt).toLocaleString('en-NZ')} />
        <MetaRow icon={<Users size={14} />}    label="Agent"   value={data.agentName ?? '— (channel-only)'} />
        <MetaRow icon={<Hash size={14} />}     label="Campaign" value={data.campaignLabel ?? '—'} />
      </div>

      <Card className="mb-6">
        <CardContent>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-3">
            Full destination URL
          </h2>
          <code className="block text-xs text-[#1E3A5F] break-all bg-[#FAF8F3] p-3 rounded-xl border border-gray-100">
            {data.destination}
          </code>
        </CardContent>
      </Card>

      <LinkStatsBlock linkId={data.id} initialWindowDays={windowDays} />
    </div>
  );
}

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60">
          {icon} {label}
        </div>
        <div className="text-sm text-[#1E3A5F] mt-1 truncate">{value}</div>
      </CardContent>
    </Card>
  );
}
