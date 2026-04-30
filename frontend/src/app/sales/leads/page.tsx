import Link from 'next/link';
import { apiServer } from '@/lib/apiServer';
import { Card, CardContent } from '@/components/ui/Card';
import { Users } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { LEAD_STATUS_GLOSSARY } from '@/lib/glossary';

type ScoreBand = 'HOT' | 'WARM' | 'COOL' | 'COLD' | null;
type LeadStatus =
  | 'NEW'
  | 'QUALIFIED'
  | 'CONTACTED'
  | 'NURTURE'
  | 'CONVERTED'
  | 'DISQUALIFIED';

interface Lead {
  id: string;
  leadStatus: LeadStatus;
  scoreBand: ScoreBand;
  readinessScore: number | null;
  countryConfigId: string | null;
  createdAt: string;
  hardStopFlag: boolean;
  contact: {
    id: string;
    fullName: string;
    email: string | null;
    countryOfResidence: string | null;
  };
}

const bandStyles: Record<string, string> = {
  HOT: 'bg-red-50 text-red-700 border-red-200',
  WARM: 'bg-orange-50 text-orange-700 border-orange-200',
  COOL: 'bg-blue-50 text-blue-700 border-blue-200',
  COLD: 'bg-gray-100 text-gray-600 border-gray-200',
};

const statusStyles: Record<string, string> = {
  NEW: 'bg-[#FAF8F3] text-[#1E3A5F] border-[#1E3A5F]/20',
  QUALIFIED: 'bg-[#E8B923]/10 text-[#1E3A5F] border-[#E8B923]/40',
  CONTACTED: 'bg-blue-50 text-blue-700 border-blue-200',
  NURTURE: 'bg-purple-50 text-purple-700 border-purple-200',
  CONVERTED: 'bg-green-50 text-green-700 border-green-200',
  DISQUALIFIED: 'bg-gray-100 text-gray-500 border-gray-200',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-NZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default async function SalesLeadsPage() {
  let leads: Lead[] = [];
  let errorMessage: string | null = null;

  try {
    leads = await apiServer.get<Lead[]>('/leads');
  } catch (err: any) {
    errorMessage = err?.message || 'Could not load leads.';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F]">Leads</h1>
          <p className="text-sm text-[#4A4A4A]/70 mt-1">
            All incoming leads across every channel.
          </p>
        </div>
      </div>

      {errorMessage && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4">
            <p className="text-sm text-red-700">{errorMessage}</p>
          </CardContent>
        </Card>
      )}

      {!errorMessage && leads.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Users size={32} className="mx-auto text-[#1E3A5F]/30 mb-3" />
            <p className="text-[#4A4A4A] font-medium">No leads yet</p>
            <p className="text-sm text-[#4A4A4A]/60 mt-1">
              Leads will appear here as soon as ScoreApp or WhatsApp captures
              them.
            </p>
          </CardContent>
        </Card>
      )}

      {leads.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#FAF8F3] border-b border-[#1E3A5F]/10">
                <tr className="text-left text-[#1E3A5F] font-medium">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Country</th>
                  <th className="px-4 py-3">Band</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="border-b border-[#1E3A5F]/5 hover:bg-[#FAF8F3] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/sales/leads/${lead.id}`}
                        className="text-[#1E3A5F] font-medium hover:text-[#E8B923] transition-colors"
                      >
                        {lead.contact.fullName}
                      </Link>
                      {lead.contact.email && (
                        <div className="text-xs text-[#4A4A4A]/60 mt-0.5">
                          {lead.contact.email}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#4A4A4A]">
                      {lead.contact.countryOfResidence || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {lead.scoreBand ? (
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full border ${
                            bandStyles[lead.scoreBand] || ''
                          }`}
                        >
                          {lead.scoreBand}
                        </span>
                      ) : (
                        <span className="text-[#4A4A4A]/40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#4A4A4A]">
                      {lead.readinessScore ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full border ${
                            statusStyles[lead.leadStatus] || ''
                          }`}
                        >
                          {lead.leadStatus}
                        </span>
                        {LEAD_STATUS_GLOSSARY[lead.leadStatus] && (
                          <InfoTip entry={LEAD_STATUS_GLOSSARY[lead.leadStatus]} />
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#4A4A4A]/70">
                      {formatDate(lead.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
