import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, AlertTriangle, Lock, FileText, UserCheck, Mail, Phone, Gavel, Scale } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import {
  riskStyles, riskLabel, stageStyles, stageLabel,
  decisionStyles, decisionLabel, docStatusStyles,
  formatDate, formatDateTime, formatRelative,
} from '../../_utils/format';
import { ClearHardStopButton } from './ClearHardStopButton';
import { OverrideRiskButton } from './OverrideRiskButton';
import { AddLegalNoteButton } from './AddLegalNoteButton';
import { RecordDecisionButton } from './RecordDecisionButton';

// PR-LIA-1 — Case detail with action panel + legal-notes timeline.

interface CaseDetail {
  id: string;
  stage: string;
  status: string;
  riskLevel: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lead: {
    id: string;
    leadStatus: string;
    riskLevel: string | null;
    riskFlags: string[];
    hardStopFlag: boolean;
    hardStopReason: string | null;
    executionAllowed: boolean;
    aiSummary: string | null;
    readinessScore: number | null;
    academicScore: number | null;
    financialScore: number | null;
    englishScore: number | null;
    intentScore: number | null;
    countryRaw: string | null;
    contact: {
      id: string;
      fullName: string | null;
      email: string | null;
      phone: string | null;
      countryOfResidence: string | null;
    } | null;
  };
  owner: { id: string; name: string; email: string } | null;
  applications: Array<{
    id: string;
    status: string;
    submittedAt: string | null;
    notes: string | null;
    provider: { id: string; name: string } | null;
    programme: { id: string; name: string } | null;
    documents: Array<{ id: string; type: string; status: string; fileName: string | null }>;
  }>;
  contract: {
    id: string;
    status: string;
    signedAt: string | null;
  } | null;
}

interface LegalNote {
  id: string;
  caseId: string;
  authorId: string;
  authorName: string | null;
  body: string;
  decision: string | null;
  decisionReason: string | null;
  createdAt: string;
}

export default async function LiaCaseDetailPage({ params }: { params: { id: string } }) {
  let caseData: CaseDetail | null = null;
  let legalNotes: LegalNote[] = [];
  let errorMsg: string | null = null;

  try {
    caseData = await apiServer.get<CaseDetail>(`/cases/${params.id}`);
  } catch (e) {
    if (e instanceof ApiServerError && e.statusCode === 404) notFound();
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load case.';
  }

  if (caseData) {
    try {
      legalNotes = await apiServer.get<LegalNote[]>(`/cases/${params.id}/legal-notes`);
    } catch {
      // Non-fatal; show the timeline empty if it fails.
    }
  }

  if (errorMsg || !caseData) {
    return (
      <div className="max-w-3xl">
        <Link href="/lia/cases" className="inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#E8B923] mb-4">
          <ArrowLeft size={14} /> Back to cases
        </Link>
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg ?? 'Case unavailable.'}</CardContent>
        </Card>
      </div>
    );
  }

  const contact = caseData.lead.contact;
  const totalDocs = caseData.applications.reduce((acc, a) => acc + a.documents.length, 0);

  return (
    <div className="max-w-7xl">
      <Link href="/lia/cases" className="inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#E8B923] mb-4">
        <ArrowLeft size={14} /> Back to cases
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">{contact?.fullName ?? 'Unknown applicant'}</h1>
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <span className="text-xs text-[#4A4A4A]/70">Case {caseData.id.slice(0, 8)}</span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${stageStyles(caseData.stage)}`}>
            {stageLabel(caseData.stage)}
          </span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${riskStyles(caseData.riskLevel)}`}>
            {riskLabel(caseData.riskLevel)} risk
          </span>
        </div>
      </div>

      {(caseData.lead.hardStopFlag || caseData.lead.riskFlags.length > 0) && (
        <div className="mb-6 rounded-xl border-2 border-red-300 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-red-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-red-900">Legal flags raised</h2>
              {caseData.lead.hardStopFlag && (
                <p className="text-sm text-red-800 mt-1">
                  <strong>Hard stop:</strong> {caseData.lead.hardStopReason ?? 'No reason recorded.'}
                </p>
              )}
              {caseData.lead.riskFlags.length > 0 && (
                <p className="text-sm text-red-800 mt-1">
                  <strong>Risk flags:</strong> {caseData.lead.riskFlags.join(', ')}
                </p>
              )}
              {!caseData.lead.executionAllowed && (
                <p className="text-sm text-red-800 mt-1">Execution is not currently allowed for this lead.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <Card className="mb-6">
        <CardContent>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-4">Action panel</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <ClearHardStopButton
              caseId={caseData.id}
              disabled={!caseData.lead.hardStopFlag}
              hint={caseData.lead.hardStopFlag ? caseData.lead.hardStopReason : null}
            />
            <OverrideRiskButton caseId={caseData.id} currentRisk={caseData.riskLevel} />
            <AddLegalNoteButton caseId={caseData.id} />
            <RecordDecisionButton caseId={caseData.id} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card>
          <CardContent>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-3">Contact</h3>
            <div className="space-y-2">
              <Row icon={<UserCheck size={14} />} value={contact?.fullName ?? '—'} />
              <Row icon={<Mail size={14} />}      value={contact?.email ?? '—'} />
              <Row icon={<Phone size={14} />}     value={contact?.phone ?? '—'} />
              <Row icon={<FileText size={14} />}  value={contact?.countryOfResidence ?? caseData.lead.countryRaw ?? '—'} label="Country" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-3">Lead intelligence</h3>
            <dl className="space-y-1.5 text-sm">
              <KV label="Lead status" value={caseData.lead.leadStatus} />
              <KV label="Readiness" value={caseData.lead.readinessScore != null ? `${caseData.lead.readinessScore}` : '—'} />
              <KV label="Academic"  value={caseData.lead.academicScore  != null ? `${caseData.lead.academicScore}`  : '—'} />
              <KV label="Financial" value={caseData.lead.financialScore != null ? `${caseData.lead.financialScore}` : '—'} />
              <KV label="English"   value={caseData.lead.englishScore   != null ? `${caseData.lead.englishScore}`   : '—'} />
              <KV label="Intent"    value={caseData.lead.intentScore    != null ? `${caseData.lead.intentScore}`    : '—'} />
            </dl>
            {caseData.lead.aiSummary && (
              <p className="mt-3 text-xs text-[#4A4A4A] whitespace-pre-wrap leading-relaxed border-t border-gray-100 pt-3">
                {caseData.lead.aiSummary}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-3">Owner</h3>
            {caseData.owner ? (
              <div className="space-y-2">
                <Row icon={<UserCheck size={14} />} value={caseData.owner.name} />
                <Row icon={<Mail size={14} />} value={caseData.owner.email} />
              </div>
            ) : (
              <p className="text-sm text-[#4A4A4A]/60 italic">Unassigned</p>
            )}
            <p className="text-xs text-[#4A4A4A]/60 mt-3 border-t border-gray-100 pt-3">
              Case opened {formatDate(caseData.createdAt)} · updated {formatRelative(caseData.updatedAt)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-[#1E3A5F]">Applications</h2>
            <span className="text-xs text-[#4A4A4A]/60">
              {caseData.applications.length} application{caseData.applications.length === 1 ? '' : 's'} · {totalDocs} doc{totalDocs === 1 ? '' : 's'}
            </span>
          </div>
          {caseData.applications.length === 0 ? (
            <p className="text-sm text-[#4A4A4A]/60 py-6 text-center">No applications yet.</p>
          ) : (
            <ul className="space-y-3">
              {caseData.applications.map(a => (
                <li key={a.id} className="rounded-xl border border-gray-100 bg-white p-4">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="font-semibold text-[#1E3A5F]">{a.programme?.name ?? 'Programme'}</span>
                    <span className="text-xs text-[#4A4A4A]/60">· {a.provider?.name ?? 'Provider'}</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100 ml-auto">
                      {a.status}
                    </span>
                  </div>
                  {a.documents.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap mt-2">
                      {a.documents.map(d => (
                        <span key={d.id} className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium ${docStatusStyles(d.status)}`}>
                          {d.type}: {d.status}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {caseData.contract && (
        <Card className="mb-6">
          <CardContent>
            <h2 className="text-lg font-bold text-[#1E3A5F] mb-3">Contract</h2>
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                {caseData.contract.status}
              </span>
              <span className="text-[#4A4A4A]/70">
                {caseData.contract.signedAt ? `Signed ${formatDate(caseData.contract.signedAt)}` : 'Not yet signed'}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          <div className="flex items-center gap-2 mb-4">
            <Scale size={18} className="text-[#E8B923]" />
            <h2 className="text-lg font-bold text-[#1E3A5F]">Legal notes &amp; decisions</h2>
          </div>

          {legalNotes.length === 0 ? (
            <p className="text-sm text-[#4A4A4A]/60 py-6 text-center">No legal entries yet. Use the action panel above to add one.</p>
          ) : (
            <ul className="space-y-3">
              {legalNotes.map(n => (
                <li
                  key={n.id}
                  className={`rounded-xl border p-4 ${
                    n.decision
                      ? `${decisionStyles(n.decision)} border-current`
                      : 'border-gray-100 bg-[#FAF8F3]'
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    {n.decision ? (
                      <Gavel size={14} className="text-current" />
                    ) : (
                      <Lock size={14} className="text-[#4A4A4A]/60" />
                    )}
                    {n.decision ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-white/50">
                        Decision: {decisionLabel(n.decision)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold bg-white border border-gray-200 text-[#4A4A4A]">
                        Note
                      </span>
                    )}
                    <span className="text-xs text-[#4A4A4A]/70 ml-auto">
                      {n.authorName ?? '—'} · {formatDateTime(n.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{n.body}</p>
                  {n.decisionReason && (
                    <div className="mt-2 pt-2 border-t border-white/40">
                      <p className="text-xs font-semibold uppercase tracking-wider opacity-70 mb-1">Justification</p>
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{n.decisionReason}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ icon, value, label }: { icon: React.ReactNode; value: string; label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-[#4A4A4A]/50 flex-shrink-0">{icon}</span>
      <span className="text-[#4A4A4A] min-w-0 truncate">
        {label && <span className="text-[#4A4A4A]/60 mr-1">{label}:</span>}
        {value}
      </span>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-[#4A4A4A]/70 text-xs">{label}</dt>
      <dd className="text-[#1E3A5F] font-medium">{value}</dd>
    </div>
  );
}

