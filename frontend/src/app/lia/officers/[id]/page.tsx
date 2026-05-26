import Link from 'next/link';
import { notFound } from 'next/navigation';
import { UserSquare2, MapPin, FileSearch, ArrowRight, Globe, Briefcase, MessageSquare, Calendar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { BackLink } from '@/components/ui/BackLink';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { getSession } from '@/lib/auth';
import { formatDate, formatRelative } from '../../_utils/format';
import { EditOfficerButton } from './EditOfficerButton';
import { DeleteOfficerButton } from './DeleteOfficerButton';
import { AddObservationButton } from './AddObservationButton';
import { DeleteObservationButton } from './DeleteObservationButton';
import { OfficerTrendCharts } from './OfficerTrendCharts';

// PR-LIA-10 — Officer detail page.

interface OfficerDetail {
  officer: {
    id: string;
    fullName: string;
    officerCode: string | null;
    branch: string | null;
    countryOfPosting: string | null;
    profileDescription: string | null;
    createdById: string;
    createdByName: string | null;
    createdAt: string;
    updatedAt: string;
    totalCases: number;
    approvedCases: number;
    declinedCases: number;
    pendingCases: number;
    observationCount: number;
    topCountries: string[];
    topCaseTypes: string[];
  };
  observations: Array<{
    id: string;
    officerId: string;
    authorId: string;
    authorName: string | null;
    body: string;
    tags: string[];
    createdAt: string;
  }>;
  linkages: Array<{
    id: string;
    caseId: string;
    officerId: string;
    linkedOutcome: 'APPROVED' | 'DECLINED' | null;
    note: string | null;
    linkedById: string;
    linkedByName: string | null;
    linkedAt: string;
    applicantName: string | null;
  }>;
}

export default async function OfficerDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  const canDelete = !!session && ['OWNER', 'SUPER_ADMIN'].includes(session.role);
  const myId = session?.userId ?? '';

  let data: OfficerDetail | null = null;
  let errorMsg: string | null = null;
  try {
    data = await apiServer.get<OfficerDetail>(`/officers/${params.id}`);
  } catch (e) {
    if (e instanceof ApiServerError && e.statusCode === 404) notFound();
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load officer.';
  }

  if (errorMsg || !data) {
    return (
      <div className="max-w-4xl">
        <BackLink href="/lia/officers" label="Back to officers" />
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg ?? 'Officer unavailable.'}</CardContent>
        </Card>
      </div>
    );
  }

  const { officer, observations, linkages } = data;

  return (
    <div className="max-w-7xl">
      <BackLink href="/lia/officers" label="Back to officers" />

      <div className="mb-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex items-start gap-3">
            <div className="w-12 h-12 rounded-full bg-[#1E3A5F]/10 flex items-center justify-center flex-shrink-0">
              <UserSquare2 size={22} className="text-[#1E3A5F]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-[#1E3A5F]">{officer.fullName}</h1>
                <EditOfficerButton
                  officerId={officer.id}
                  currentFullName={officer.fullName}
                  currentOfficerCode={officer.officerCode}
                  currentBranch={officer.branch}
                  currentCountryOfPosting={officer.countryOfPosting}
                  currentProfileDescription={officer.profileDescription}
                />
              </div>
              <div className="text-sm text-[#4A4A4A]/70 mt-1 flex items-center gap-2 flex-wrap">
                {officer.officerCode && <span className="font-mono text-xs bg-[#FAF8F3] px-2 py-0.5 rounded">{officer.officerCode}</span>}
                {officer.branch && <span className="flex items-center gap-1"><MapPin size={12} /> {officer.branch}</span>}
                {officer.countryOfPosting && <span className="flex items-center gap-1"><Globe size={12} /> {officer.countryOfPosting}</span>}
              </div>
            </div>
          </div>
          {canDelete && (
            <DeleteOfficerButton officerId={officer.id} officerFullName={officer.fullName} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-2">
          <CardContent>
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-3">Profile</h2>
            {officer.profileDescription ? (
              <p className="text-sm text-[#1E3A5F] whitespace-pre-wrap leading-relaxed">{officer.profileDescription}</p>
            ) : (
              <p className="text-sm text-[#4A4A4A]/60 italic">No profile description yet. Click the pencil icon above to add one.</p>
            )}
            <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-[#4A4A4A]/60">
              Created by {officer.createdByName ?? 'unknown'} · {formatDate(officer.createdAt)}
              {officer.updatedAt !== officer.createdAt && (
                <span> · last updated {formatRelative(officer.updatedAt)}</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-3">Stats</h2>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <StatTile label="Total cases" value={officer.totalCases} tone="navy" />
              <StatTile label="Observations" value={officer.observationCount} tone="gold" />
              <StatTile label="Approved" value={officer.approvedCases} tone="emerald" />
              <StatTile label="Declined" value={officer.declinedCases} tone="red" />
            </div>
            <div className="text-xs text-[#4A4A4A]/60 mb-1">Pending at link time: <span className="font-bold text-[#1E3A5F]">{officer.pendingCases}</span></div>

            {officer.topCountries.length > 0 && (
              <div className="mt-4 pt-3 border-t border-gray-100">
                <div className="text-xs font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-2">Top client countries</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {officer.topCountries.map((c) => (
                    <span key={c} className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200">{c}</span>
                  ))}
                </div>
              </div>
            )}
            {officer.topCaseTypes.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-2">Top case stages at link</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {officer.topCaseTypes.map((s) => (
                    <span key={s} className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold bg-[#1E3A5F]/5 text-[#1E3A5F]">{s}</span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardContent>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-lg font-bold text-[#1E3A5F] flex items-center gap-2">
              <MessageSquare size={18} className="text-[#E8B923]" />
              Observations
              <span className="text-sm font-medium text-[#4A4A4A]/60 ml-1">{observations.length}</span>
            </h2>
            <AddObservationButton officerId={officer.id} />
          </div>

          {observations.length === 0 ? (
            <p className="text-sm text-[#4A4A4A]/60 py-6 text-center italic">
              No observations yet. Be the first to share an insight about this officer.
            </p>
          ) : (
            <ul className="space-y-3">
              {observations.map((o) => (
                <li key={o.id} className="rounded-xl border border-gray-100 bg-white p-4">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="text-sm font-semibold text-[#1E3A5F]">{o.authorName ?? 'Unknown'}</span>
                    <span className="text-xs text-[#4A4A4A]/60">· {formatRelative(o.createdAt)}</span>
                    {o.authorId === myId && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#E8B923] ml-1">You</span>
                    )}
                    <div className="ml-auto">
                      {o.authorId === myId && (
                        <DeleteObservationButton officerId={officer.id} observationId={o.id} />
                      )}
                    </div>
                  </div>
                  {o.tags.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap mb-2">
                      {o.tags.map((t) => (
                        <span key={t} className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-[#FAF8F3] text-[#4A4A4A] border border-gray-200">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-sm text-[#1E3A5F] whitespace-pre-wrap leading-relaxed">{o.body}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* PR-LIA-11: per-officer decision-trend charts. */}
      <Card className="mb-6">
        <CardContent>
          <OfficerTrendCharts officerId={officer.id} />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="flex items-center gap-2 mb-4">
            <Briefcase size={18} className="text-[#E8B923]" />
            <h2 className="text-lg font-bold text-[#1E3A5F]">Linked cases</h2>
            <span className="text-sm font-medium text-[#4A4A4A]/60 ml-1">{linkages.length}</span>
          </div>

          {linkages.length === 0 ? (
            <p className="text-sm text-[#4A4A4A]/60 py-6 text-center italic">
              No cases linked to this officer yet.
            </p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#FAF8F3] text-[#4A4A4A]/70 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2 text-left">Applicant</th>
                      <th className="px-3 py-2 text-left">Case ID</th>
                      <th className="px-3 py-2 text-left">Outcome at link</th>
                      <th className="px-3 py-2 text-left">Linked by</th>
                      <th className="px-3 py-2 text-left">Linked</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {linkages.map((l) => (
                      <tr key={l.id} className="hover:bg-[#FAF8F3]/50">
                        <td className="px-3 py-2 font-semibold text-[#1E3A5F]">{l.applicantName ?? 'Unknown'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-[#4A4A4A]">{l.caseId.slice(0, 8)}</td>
                        <td className="px-3 py-2">
                          <OutcomeBadge outcome={l.linkedOutcome} />
                        </td>
                        <td className="px-3 py-2 text-[#4A4A4A]">{l.linkedByName ?? '—'}</td>
                        <td className="px-3 py-2 text-xs text-[#4A4A4A]/70">
                          <span className="inline-flex items-center gap-1">
                            <Calendar size={11} /> {formatRelative(l.linkedAt)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link href={`/lia/cases/${l.caseId}`} className="inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F] hover:text-[#E8B923]">
                            View case <ArrowRight size={12} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile cards */}
              <ul className="md:hidden divide-y divide-gray-100">
                {linkages.map((l) => (
                  <li key={l.id} className="py-3">
                    <Link href={`/lia/cases/${l.caseId}`} className="block">
                      <div className="flex items-start gap-2 mb-1">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-[#1E3A5F]">{l.applicantName ?? 'Unknown'}</div>
                          <div className="text-xs text-[#4A4A4A]/60 mt-0.5">Case {l.caseId.slice(0, 8)}</div>
                        </div>
                        <OutcomeBadge outcome={l.linkedOutcome} />
                      </div>
                      <div className="text-xs text-[#4A4A4A]/60">
                        Linked by {l.linkedByName ?? '—'} · {formatRelative(l.linkedAt)}
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

function StatTile({ label, value, tone }: { label: string; value: number; tone: 'navy' | 'emerald' | 'red' | 'gold' }) {
  const tones = {
    navy: 'bg-[#1E3A5F]/5 text-[#1E3A5F]',
    emerald: 'bg-emerald-50 text-emerald-800',
    red: 'bg-red-50 text-red-800',
    gold: 'bg-[#E8B923]/20 text-[#1E3A5F]',
  };
  return (
    <div className={`rounded-lg p-3 ${tones[tone]}`}>
      <div className="text-xl font-bold leading-none">{value}</div>
      <div className="text-[10px] font-semibold mt-1">{label}</div>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: 'APPROVED' | 'DECLINED' | null }) {
  if (outcome === 'APPROVED') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
        Approved
      </span>
    );
  }
  if (outcome === 'DECLINED') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-red-100 text-red-800 border border-red-200">
        Declined
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
      Pending
    </span>
  );
}
