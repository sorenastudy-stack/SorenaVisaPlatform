import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ArrowLeft, Mail, Phone, Globe, AlertTriangle, Sparkles } from 'lucide-react';
import { LeadStatusActions } from './LeadStatusActions';
import { LeadProgressTimeline } from './LeadProgressTimeline';
import { InfoTip } from '@/components/ui/InfoTip';
import { LEAD_STATUS_GLOSSARY } from '@/lib/glossary';

type LeadStatus =
  | 'NEW' | 'CONTACTED' | 'INTAKE_STARTED' | 'INTAKE_COMPLETED' | 'SCORING_DONE'
  | 'QUALIFIED' | 'NURTURE' | 'EXECUTING' | 'CLOSED_WON' | 'CLOSED_LOST'
  | 'DISQUALIFIED';

interface LeadDetail {
  id: string;
  leadStatus: LeadStatus;
  scoreBand: string | null;
  readinessScore: number | null;
  academicScore: number | null;
  financialScore: number | null;
  englishScore: number | null;
  intentScore: number | null;
  engagementScore: number | null;
  riskLevel: string | null;
  riskFlags: string[];
  hardStopFlag: boolean;
  hardStopReason: string | null;
  liaEscalationRequired: boolean;
  executionAllowed: boolean;
  recommendedRoute: string | null;
  aiSummary: string | null;
  managerNotes: string | null;
  sourceChannel: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  createdAt: string;
  updatedAt: string;
  contact: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    nationality: string | null;
    countryOfResidence: string | null;
    preferredLanguage: string;
  };
}

const statusStyles: Record<string, string> = {
  NEW: 'bg-[#FAF8F3] text-[#1E3A5F] border-[#1E3A5F]/20',
  QUALIFIED: 'bg-[#E8B923]/10 text-[#1E3A5F] border-[#E8B923]/40',
  CONTACTED: 'bg-blue-50 text-blue-700 border-blue-200',
  NURTURE: 'bg-purple-50 text-purple-700 border-purple-200',
  CONVERTED: 'bg-green-50 text-green-700 border-green-200',
  DISQUALIFIED: 'bg-gray-100 text-gray-500 border-gray-200',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-NZ', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function ScoreRow({ label, value }: { label: string; value: number | null }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-[#4A4A4A]">{label}</span>
        <span className="text-[#1E3A5F] font-medium">
          {value == null ? '—' : `${value} / 100`}
        </span>
      </div>
      <div className="h-2 bg-[#FAF8F3] rounded-full overflow-hidden">
        <div
          className="h-full bg-[#E8B923] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
}: {
  params: { id: string };
}) {
  let lead: LeadDetail;
  try {
    lead = await apiServer.get<LeadDetail>(`/leads/${params.id}`);
  } catch (err) {
    if (err instanceof ApiServerError && err.statusCode === 404) {
      notFound();
    }
    throw err;
  }

  let history: any[] = [];
  try {
    history = await apiServer.get<any[]>(`/leads/${params.id}/history`);
  } catch {
    history = [];
  }

  return (
    <div>
      <Link
        href="/sales/leads"
        className="inline-flex items-center gap-2 text-sm text-[#1E3A5F]/70 hover:text-[#1E3A5F] mb-4 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to Leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F]">
            {lead.contact.fullName}
          </h1>
          <p className="text-sm text-[#4A4A4A]/70 mt-1">
            Lead created {formatDate(lead.createdAt)}
          </p>
        </div>
        <span className="inline-flex items-center gap-2">
          <span
            className={`inline-block px-3 py-1 text-xs font-medium rounded-full border ${
              statusStyles[lead.leadStatus] || ''
            }`}
          >
            {lead.leadStatus}
          </span>
          {LEAD_STATUS_GLOSSARY[lead.leadStatus] && (
            <InfoTip entry={LEAD_STATUS_GLOSSARY[lead.leadStatus]} iconSize={16} />
          )}
        </span>
      </div>

      <LeadProgressTimeline currentStatus={lead.leadStatus} history={history} />

      {lead.hardStopFlag && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4 flex gap-3">
            <AlertTriangle className="text-red-600 flex-shrink-0" size={20} />
            <div>
              <p className="text-sm font-medium text-red-700">Hard Stop</p>
              {lead.hardStopReason && (
                <p className="text-sm text-red-600 mt-1">{lead.hardStopReason}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {lead.liaEscalationRequired && (
        <Card className="mb-6 border-orange-200 bg-orange-50">
          <CardContent className="py-4">
            <p className="text-sm font-medium text-orange-700">
              LIA escalation required — route to legal advisor before proceeding.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-[#1E3A5F]">Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {lead.contact.email && (
              <div className="flex items-center gap-2 text-[#4A4A4A]">
                <Mail size={14} className="text-[#E8B923] flex-shrink-0" />
                <span className="truncate">{lead.contact.email}</span>
              </div>
            )}
            {lead.contact.phone && (
              <div className="flex items-center gap-2 text-[#4A4A4A]">
                <Phone size={14} className="text-[#E8B923] flex-shrink-0" />
                <span>{lead.contact.phone}</span>
              </div>
            )}
            {lead.contact.whatsapp && (
              <div className="flex items-center gap-2 text-[#4A4A4A]">
                <Phone size={14} className="text-green-600 flex-shrink-0" />
                <span>WhatsApp: {lead.contact.whatsapp}</span>
              </div>
            )}
            {lead.contact.countryOfResidence && (
              <div className="flex items-center gap-2 text-[#4A4A4A]">
                <Globe size={14} className="text-[#E8B923] flex-shrink-0" />
                <span>
                  {lead.contact.countryOfResidence}
                  {lead.contact.nationality &&
                  lead.contact.nationality !== lead.contact.countryOfResidence
                    ? ` (${lead.contact.nationality})`
                    : ''}
                </span>
              </div>
            )}
            <div className="pt-2 border-t border-[#1E3A5F]/10 text-xs text-[#4A4A4A]/60">
              <div>Language: {lead.contact.preferredLanguage.toUpperCase()}</div>
              {lead.sourceChannel && <div>Source: {lead.sourceChannel}</div>}
              {lead.utmCampaign && <div>Campaign: {lead.utmCampaign}</div>}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-[#1E3A5F]">
              <span>Scoring</span>
              {lead.scoreBand && (
                <span className="text-xs font-medium bg-[#E8B923]/10 text-[#1E3A5F] border border-[#E8B923]/40 px-2 py-0.5 rounded-full">
                  Band: {lead.scoreBand}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScoreRow label="Readiness (overall)" value={lead.readinessScore} />
            <ScoreRow label="Academic" value={lead.academicScore} />
            <ScoreRow label="Financial" value={lead.financialScore} />
            <ScoreRow label="English" value={lead.englishScore} />
            <ScoreRow label="Intent" value={lead.intentScore} />
            <ScoreRow label="Engagement" value={lead.engagementScore} />
            {lead.recommendedRoute && (
              <div className="mt-4 pt-4 border-t border-[#1E3A5F]/10 text-sm">
                <span className="text-[#4A4A4A]/70">Recommended route: </span>
                <span className="text-[#1E3A5F] font-medium">
                  {lead.recommendedRoute}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {lead.aiSummary && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#1E3A5F]">
              <Sparkles size={16} className="text-[#E8B923]" />
              AI Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#4A4A4A] leading-relaxed whitespace-pre-wrap">
              {lead.aiSummary}
            </p>
          </CardContent>
        </Card>
      )}

      {lead.riskFlags && lead.riskFlags.length > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-[#1E3A5F]">Risk Flags</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {lead.riskFlags.map((flag) => (
                <span
                  key={flag}
                  className="inline-block px-2 py-0.5 text-xs font-medium rounded-full border bg-orange-50 text-orange-700 border-orange-200"
                >
                  {flag}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-[#1E3A5F]">Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <LeadStatusActions leadId={lead.id} currentStatus={lead.leadStatus} />
        </CardContent>
      </Card>
    </div>
  );
}
