import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, AlertTriangle, Lock, FileText, UserCheck, Mail, Phone, Gavel, Scale, MessageSquare, FilePlus2, CheckCircle2, Files, XCircle, HelpCircle, ScrollText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { getSession } from '@/lib/auth';
import {
  riskStyles, riskLabel, stageStyles, stageLabel,
  decisionStyles, decisionLabel, docStatusStyles,
  formatDate, formatDateTime, formatRelative, formatDaysSince,
  completedOutcomeLabel, completedOutcomeStyles,
  visaExpiryStyles, visaExpiryLabel,
} from '../../_utils/format';
import { ClearHardStopButton } from './ClearHardStopButton';
import { OverrideRiskButton } from './OverrideRiskButton';
import { AddLegalNoteButton } from './AddLegalNoteButton';
import { RecordDecisionButton } from './RecordDecisionButton';
import { SendMessageButton } from './SendMessageButton';
import { RequestDocumentButton } from './RequestDocumentButton';
import { ReassignLiaButton } from './ReassignLiaButton';
import { DownloadDocumentButton } from './DownloadDocumentButton';
import { ReviewDocumentButton } from './ReviewDocumentButton';
import { SubmitToInzButton } from './SubmitToInzButton';
import { EditInzSubmissionButton } from './EditInzSubmissionButton';
import { RevertInzSubmissionButton } from './RevertInzSubmissionButton';
import { DownloadInzReceiptButton } from './DownloadInzReceiptButton';
import { RecordVisaApprovalButton } from './RecordVisaApprovalButton';
import { RecordVisaDeclineButton } from './RecordVisaDeclineButton';
import { EditVisaRecordButton } from './EditVisaRecordButton';
import { RevertVisaRecordButton } from './RevertVisaRecordButton';
import { DownloadVisaButton } from './DownloadVisaButton';
import { LinkOfficerButton } from './LinkOfficerButton';
import { UnlinkOfficerButton } from './UnlinkOfficerButton';
import { CopyButton } from './inz-data/CopyButton';

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
  // PR-LIA-2: the assigned LIA (set on contract sign / manual reassign).
  lia: { id: string; name: string; email: string } | null;
  // PR-LIA-3: timestamp the LIA was attached. Null when unassigned.
  liaAssignedAt: string | null;
  // PR-LIA-7: INZ submission lifecycle fields. All NULL until the
  // LIA hits "Submit to INZ".
  inzApplicationNumber: string | null;
  inzSubmittedAt: string | null;
  inzSubmissionNotes: string | null;
  inzReceiptFileName: string | null;
  inzReceiptMimeType: string | null;
  inzReceiptSizeBytes: number | null;
  // PR-LIA-8: visa outcome row (1:0..1). NULL until the LIA records
  // the INZ outcome via /visa/issue or /visa/decline. declineReason
  // is decrypted at the boundary by cases.service.ts.
  visa: {
    id: string;
    outcome: 'APPROVED' | 'DECLINED';
    visaStartDate: string | null;
    visaEndDate: string | null;
    visaDocumentName: string | null;
    visaDocumentMime: string | null;
    visaDocumentSize: number | null;
    declineReason: string | null;
    issuedById: string;
    issuedAt: string;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
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

interface CaseMessage {
  id: string;
  caseId: string;
  authorId: string;
  authorName: string | null;
  authorRole: 'LIA' | 'CLIENT';
  kind: 'MESSAGE' | 'DOCUMENT_REQUEST' | 'PROGRESS_UPDATE';
  body: string;
  requestedDocType: string | null;
  fulfilledByFileId: string | null;
  fulfilledByFileName: string | null;
  fulfilledAt: string | null;
  readByClient: boolean;
  readByLia: boolean;
  createdAt: string;
}

// PR-LIA-10: case ↔ reviewing officer linkage. NULL when no officer
// is linked to this case. Note is decrypted server-side.
interface OfficerLinkage {
  id: string;
  caseId: string;
  officerId: string;
  linkedOutcome: 'APPROVED' | 'DECLINED' | null;
  note: string | null;
  linkedById: string;
  linkedByName: string | null;
  linkedAt: string;
}

// PR-LIA-5: unified client-document row across all sources.
interface CaseDocumentRow {
  id: string;
  source: 'ADMISSION' | 'APPLICATION' | 'VISA_SUPPORTING';
  sourceRowId: string;
  docType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedById: string | null;
  uploadedByName: string | null;
  downloadable: boolean;
  linkedToRequestMessageId: string | null;
  liaReviewStatus: 'UNREVIEWED' | 'APPROVED' | 'REJECTED';
  liaReviewedAt: string | null;
  liaReviewedById: string | null;
  liaReviewedByName: string | null;
  liaReviewReason: string | null;
}

export default async function LiaCaseDetailPage({ params }: { params: { id: string } }) {
  // PR-LIA-2 — read viewer's role so we can show the Reassign button
  // only to OWNER / ADMIN / SUPER_ADMIN, and the "(you)" badge to the
  // currently-assigned LIA.
  const session = await getSession();
  const canReassign = !!session && ['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(session.role);

  let caseData: CaseDetail | null = null;
  let legalNotes: LegalNote[] = [];
  let caseMessages: CaseMessage[] = [];
  let caseDocuments: CaseDocumentRow[] = [];
  let officerLinkage: OfficerLinkage | null = null;
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
    try {
      caseMessages = await apiServer.get<CaseMessage[]>(`/cases/${params.id}/messages`);
    } catch {
      // Non-fatal; show the message thread empty if it fails.
    }
    try {
      caseDocuments = await apiServer.get<CaseDocumentRow[]>(`/cases/${params.id}/documents`);
    } catch {
      // Non-fatal; show the documents card empty if it fails.
    }
    try {
      // PR-LIA-10: returns null when no officer is linked. apiServer.get
      // treats null as a valid response shape; we cast through unknown
      // because the typed generic doesn't model nullable bodies natively.
      officerLinkage = (await apiServer.get<OfficerLinkage | null>(
        `/cases/${params.id}/officer-linkage`,
      )) ?? null;
    } catch {
      officerLinkage = null;
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
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[#1E3A5F]">{contact?.fullName ?? 'Unknown applicant'}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <span className="text-xs text-[#4A4A4A]/70">Case {caseData.id.slice(0, 8)}</span>
              {caseData.stage === 'COMPLETED' ? (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${completedOutcomeStyles(caseData.visa?.outcome ?? null)}`}>
                  {completedOutcomeLabel(caseData.visa?.outcome ?? null)}
                </span>
              ) : (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${stageStyles(caseData.stage)}`}>
                  {stageLabel(caseData.stage)}
                </span>
              )}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${riskStyles(caseData.riskLevel)}`}>
                {riskLabel(caseData.riskLevel)} risk
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
            {/* PR-LIA-12: chronological master log for this case. */}
            <Link
              href={`/lia/cases/${caseData.id}/file-note`}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-[#E8B923]/40 text-[#1E3A5F] text-sm font-semibold hover:border-[#E8B923] hover:text-[#E8B923] transition-colors"
            >
              <ScrollText size={16} /> View Case File Note
            </Link>
            {/* PR-LIA-6: consolidated INZ data viewer entry point. */}
            <Link
              href={`/lia/cases/${caseData.id}/inz-data`}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1E3A5F] text-white text-sm font-semibold hover:bg-[#E8B923] hover:text-[#1E3A5F] transition-colors"
            >
              <FileText size={16} /> View INZ application data →
            </Link>
          </div>
        </div>
      </div>

      {/* PR-LIA-9 Visa expiry banner — amber/red strip above the
          panels when an approved visa is within 30 days of expiry
          or already expired. Renders nothing otherwise. */}
      <VisaExpiryBanner caseData={caseData} />

      {/* PR-LIA-7 INZ Submission panel — three states by stage. */}
      <InzSubmissionPanel caseData={caseData} />

      {/* PR-LIA-8 Visa Outcome panel — CTAs while INZ_SUBMITTED with no
          visa row; full record once issued or declined. */}
      <VisaOutcomePanel caseData={caseData} />

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
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#4A4A4A]/60">Assigned LIA</h3>
              {canReassign && (
                <ReassignLiaButton
                  caseId={caseData.id}
                  currentLiaId={caseData.lia?.id ?? null}
                  currentLiaName={caseData.lia?.name ?? null}
                />
              )}
            </div>
            {caseData.lia ? (
              <div className="space-y-2">
                <Row
                  icon={<UserCheck size={14} />}
                  value={
                    caseData.lia.id === session?.userId
                      ? `${caseData.lia.name} (you)`
                      : caseData.lia.name
                  }
                />
                <Row icon={<Mail size={14} />} value={caseData.lia.email} />
              </div>
            ) : (
              <p className="text-sm text-[#4A4A4A]/60 italic">
                No LIA assigned yet. Auto-assignment fires on contract sign.
              </p>
            )}
            <div className="text-xs text-[#4A4A4A]/60 mt-3 border-t border-gray-100 pt-3 space-y-0.5">
              <div>
                Case opened {formatDate(caseData.createdAt)} · updated {formatRelative(caseData.updatedAt)}
              </div>
              <div>Case age: {formatDaysSince(caseData.createdAt)}</div>
              {caseData.liaAssignedAt
                && formatDaysSince(caseData.liaAssignedAt) !== formatDaysSince(caseData.createdAt) && (
                <div>Assigned {formatDaysSince(caseData.liaAssignedAt)} ago</div>
              )}
              {caseData.owner && (
                <div>CRM owner: {caseData.owner.name}</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PR-LIA-10: reviewing officer panel between the assignment row
          and the applications list. */}
      <ReviewingOfficerPanel caseId={caseData.id} linkage={officerLinkage} />

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

      <Card className="mb-6">
        <CardContent>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-lg font-bold text-[#1E3A5F] flex items-center gap-2">
              <Files size={18} className="text-[#E8B923]" />
              All client documents
            </h2>
            <span className="text-xs text-[#4A4A4A]/60">
              {caseDocuments.length} document{caseDocuments.length === 1 ? '' : 's'} across admission / application / visa
            </span>
          </div>

          {caseDocuments.length === 0 ? (
            <p className="text-sm text-[#4A4A4A]/60 py-6 text-center">
              The client hasn&apos;t uploaded any documents yet.
            </p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#FAF8F3] text-[#4A4A4A]/70 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">Filename</th>
                      <th className="px-3 py-2 text-left">Source</th>
                      <th className="px-3 py-2 text-left">Uploaded</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {caseDocuments.map((d) => (
                      <tr key={d.id} className="hover:bg-[#FAF8F3]/50">
                        <td className="px-3 py-2 font-semibold text-[#1E3A5F]">{d.docType}</td>
                        <td className="px-3 py-2 text-[#4A4A4A] max-w-[14rem] truncate" title={d.fileName}>{d.fileName}</td>
                        <td className="px-3 py-2 text-xs text-[#4A4A4A]/70">{sourceLabel(d.source)}</td>
                        <td className="px-3 py-2 text-xs text-[#4A4A4A]/80">{formatRelative(d.uploadedAt)}</td>
                        <td className="px-3 py-2"><ReviewStatusBadge status={d.liaReviewStatus} /></td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <DownloadDocumentButton
                              caseId={caseData.id}
                              source={d.source}
                              sourceRowId={d.sourceRowId}
                              downloadable={d.downloadable}
                              fileName={d.fileName}
                            />
                            <ReviewDocumentButton
                              caseId={caseData.id}
                              source={d.source}
                              sourceRowId={d.sourceRowId}
                              fileName={d.fileName}
                              existingStatus={d.liaReviewStatus}
                              existingReason={d.liaReviewReason}
                              existingReviewerName={d.liaReviewedByName}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile stacked cards */}
              <ul className="md:hidden divide-y divide-gray-100">
                {caseDocuments.map((d) => (
                  <li key={d.id} className="py-3">
                    <div className="flex items-start gap-2 mb-1">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[#1E3A5F]">{d.docType}</div>
                        <div className="text-xs text-[#4A4A4A]/70 truncate">{d.fileName}</div>
                      </div>
                      <ReviewStatusBadge status={d.liaReviewStatus} />
                    </div>
                    <div className="text-xs text-[#4A4A4A]/60 mb-2">
                      {sourceLabel(d.source)} · {formatRelative(d.uploadedAt)}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <DownloadDocumentButton
                        caseId={caseData.id}
                        source={d.source}
                        sourceRowId={d.sourceRowId}
                        downloadable={d.downloadable}
                        fileName={d.fileName}
                      />
                      <ReviewDocumentButton
                        caseId={caseData.id}
                        source={d.source}
                        sourceRowId={d.sourceRowId}
                        fileName={d.fileName}
                        existingStatus={d.liaReviewStatus}
                        existingReason={d.liaReviewReason}
                        existingReviewerName={d.liaReviewedByName}
                      />
                    </div>
                  </li>
                ))}
              </ul>

              <p className="text-xs text-[#4A4A4A]/60 mt-4 pt-3 border-t border-gray-100">
                Reviews are <strong>internal-only</strong> — the client doesn&apos;t see your verdict.
                For a re-upload, send a request via the case thread.
              </p>
            </>
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

      <Card className="mb-6">
        <CardContent>
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare size={18} className="text-[#E8B923]" />
            <h2 className="text-lg font-bold text-[#1E3A5F]">Messages to client</h2>
          </div>

          {caseMessages.length === 0 ? (
            <p className="text-sm text-[#4A4A4A]/60 py-6 text-center">
              No messages yet. Send the first one or request a document below.
            </p>
          ) : (
            <ul className="space-y-3 mb-4">
              {caseMessages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-100">
            <SendMessageButton caseId={caseData.id} />
            <RequestDocumentButton caseId={caseData.id} />
          </div>
        </CardContent>
      </Card>

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

function MessageBubble({ message }: { message: CaseMessage }) {
  if (message.kind === 'PROGRESS_UPDATE') {
    return (
      <li className="rounded-xl border border-[#1E3A5F]/30 bg-[#1E3A5F]/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-[#1E3A5F] text-white">
            Progress update
          </span>
          <span className="text-xs text-[#4A4A4A]/70 ml-auto">
            {message.authorName ?? 'LIA'} · {formatRelative(message.createdAt)}
          </span>
        </div>
        <p className="text-sm text-[#1E3A5F] whitespace-pre-wrap leading-relaxed">{message.body}</p>
      </li>
    );
  }

  if (message.kind === 'DOCUMENT_REQUEST') {
    const fulfilled = !!message.fulfilledByFileId;
    return (
      <li className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <FilePlus2 size={14} className="text-amber-700" />
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
            Document requested: {message.requestedDocType ?? '—'}
          </span>
          {fulfilled && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
              <CheckCircle2 size={12} /> Fulfilled
            </span>
          )}
          <span className="text-xs text-amber-700/80 ml-auto">
            {message.authorName ?? 'LIA'} · {formatRelative(message.createdAt)}
          </span>
        </div>
        <p className="text-sm text-amber-900 whitespace-pre-wrap leading-relaxed">{message.body}</p>
        {fulfilled && (
          <div className="mt-2 pt-2 border-t border-amber-200 text-xs text-amber-800">
            <span className="font-semibold">File linked:</span> {message.fulfilledByFileName ?? message.fulfilledByFileId}
            {message.fulfilledAt && (
              <span className="ml-2 text-amber-700/70">· {formatRelative(message.fulfilledAt)}</span>
            )}
          </div>
        )}
      </li>
    );
  }

  // Plain MESSAGE — LIA right-aligned gold, client left-aligned white.
  const isLia = message.authorRole === 'LIA';
  return (
    <li className={`flex ${isLia ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-xl p-4 ${
          isLia
            ? 'bg-[#E8B923]/10 border border-[#E8B923]/30'
            : 'bg-white border border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-[#1E3A5F]">{message.authorName ?? (isLia ? 'LIA' : 'Client')}</span>
          <span className="text-xs text-[#4A4A4A]/60">· {formatRelative(message.createdAt)}</span>
        </div>
        <p className="text-sm text-[#1E3A5F] whitespace-pre-wrap leading-relaxed">{message.body}</p>
      </div>
    </li>
  );
}

function sourceLabel(s: 'ADMISSION' | 'APPLICATION' | 'VISA_SUPPORTING'): string {
  switch (s) {
    case 'ADMISSION':       return 'Admission';
    case 'APPLICATION':     return 'CRM application';
    case 'VISA_SUPPORTING': return 'Visa supporting';
  }
}

function ReviewStatusBadge({ status }: { status: 'UNREVIEWED' | 'APPROVED' | 'REJECTED' }) {
  if (status === 'APPROVED') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
        <CheckCircle2 size={12} /> Approved
      </span>
    );
  }
  if (status === 'REJECTED') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-red-100 text-red-800 border border-red-200">
        <XCircle size={12} /> Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
      <HelpCircle size={12} /> Unreviewed
    </span>
  );
}

// PR-LIA-7 — three-state INZ submission panel on the case-detail page.
// VISA + no submission yet  → prominent CTA card
// INZ_SUBMITTED              → full details + Edit / Revert / Download
// COMPLETED + had submission → read-only history block
// Anything else              → render nothing
function InzSubmissionPanel({ caseData }: { caseData: CaseDetail }) {
  const submitted = !!caseData.inzSubmittedAt && !!caseData.inzApplicationNumber;
  if (caseData.stage === 'VISA' && !submitted) {
    return (
      <div className="mb-6 rounded-xl border-2 border-[#E8B923]/40 bg-[#E8B923]/5 p-5 flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-[#1E3A5F]">Ready to submit to Immigration NZ?</h2>
          <p className="text-sm text-[#4A4A4A] mt-1">
            Capture the INZ reference number, the payment receipt, and any notes. The case moves to INZ_SUBMITTED and the client gets an email confirmation.
          </p>
        </div>
        <SubmitToInzButton caseId={caseData.id} />
      </div>
    );
  }

  if (caseData.stage === 'INZ_SUBMITTED' && submitted) {
    const daysAtInz = Math.max(
      0,
      Math.floor(
        (Date.now() - new Date(caseData.inzSubmittedAt!).getTime()) / 86_400_000,
      ),
    );
    return (
      <section className="mb-6 rounded-xl border border-[#E8B923]/40 bg-white p-5">
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <CheckCircle2 size={18} className="text-emerald-600" />
          <h2 className="text-base font-bold text-[#1E3A5F]">INZ Submission</h2>
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-[#E8B923]/20 text-[#1E3A5F] border border-[#E8B923]/40 ml-1">
            SUBMITTED
          </span>
          <span className="ml-auto text-xs text-[#4A4A4A]/60">{daysAtInz} day{daysAtInz === 1 ? '' : 's'} at INZ</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60 mb-1">INZ reference</div>
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono font-bold text-[#1E3A5F] bg-[#FAF8F3] px-2 py-1 rounded">{caseData.inzApplicationNumber}</code>
              <CopyButton text={caseData.inzApplicationNumber!} variant="field" ariaLabel="Copy INZ reference" />
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60 mb-1">Submitted on</div>
            <div className="text-sm text-[#1E3A5F] font-semibold">{formatDate(caseData.inzSubmittedAt!)}</div>
            <div className="text-xs text-[#4A4A4A]/60">{formatRelative(caseData.inzSubmittedAt!)}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60 mb-1">Days at INZ</div>
            <div className="text-3xl font-bold text-[#1E3A5F] tabular-nums">{daysAtInz}</div>
          </div>
        </div>

        {caseData.inzSubmissionNotes && (
          <div className="mb-4 rounded-lg bg-[#FAF8F3] p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60 mb-1">Notes</div>
            <p className="text-sm text-[#1E3A5F] whitespace-pre-wrap">{caseData.inzSubmissionNotes}</p>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-gray-100">
          {caseData.inzReceiptFileName && (
            <DownloadInzReceiptButton caseId={caseData.id} fileName={caseData.inzReceiptFileName} />
          )}
          <EditInzSubmissionButton
            caseId={caseData.id}
            currentReference={caseData.inzApplicationNumber!}
            currentSubmittedAt={caseData.inzSubmittedAt!}
            currentNotes={caseData.inzSubmissionNotes}
          />
          <RevertInzSubmissionButton
            caseId={caseData.id}
            currentReference={caseData.inzApplicationNumber!}
          />
        </div>
      </section>
    );
  }

  if (caseData.stage === 'COMPLETED' && submitted) {
    return (
      <section className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <CheckCircle2 size={16} className="text-emerald-700" />
          <span className="font-semibold text-emerald-900">Case completed.</span>
          <span className="text-[#4A4A4A]/80">
            INZ submission was lodged on {formatDate(caseData.inzSubmittedAt!)} as <code className="font-mono">{caseData.inzApplicationNumber}</code>.
          </span>
        </div>
      </section>
    );
  }

  return null;
}

// PR-LIA-10 — Reviewing Officer panel. Shows a "link officer" CTA when
// the case has no linkage; shows the linked officer + outcome snapshot
// + linked-by metadata + optional note when one is linked.
function ReviewingOfficerPanel({
  caseId,
  linkage,
}: {
  caseId: string;
  linkage: OfficerLinkage | null;
}) {
  if (!linkage) {
    return (
      <div className="mb-6 rounded-xl border-2 border-dashed border-gray-200 bg-white p-5 flex items-center gap-4 flex-wrap">
        <div className="w-10 h-10 rounded-full bg-[#1E3A5F]/10 flex items-center justify-center flex-shrink-0">
          <UserCheck size={18} className="text-[#1E3A5F]" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-[#1E3A5F]">Reviewing officer</h3>
          <p className="text-sm text-[#4A4A4A]/70 mt-0.5">
            No INZ officer has been recorded for this case yet. Linking one lets you build officer-level analytics over time.
          </p>
        </div>
        <LinkOfficerButton caseId={caseId} />
      </div>
    );
  }

  return (
    <section className="mb-6 rounded-xl border border-[#1E3A5F]/20 bg-white p-5">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <UserCheck size={18} className="text-[#1E3A5F]" />
        <h2 className="text-base font-bold text-[#1E3A5F]">Reviewing officer</h2>
        {linkage.linkedOutcome === 'APPROVED' && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 ml-1">
            Approved at link
          </span>
        )}
        {linkage.linkedOutcome === 'DECLINED' && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-red-100 text-red-800 border border-red-200 ml-1">
            Declined at link
          </span>
        )}
        {linkage.linkedOutcome === null && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200 ml-1">
            Pending at link
          </span>
        )}
        <span className="text-xs text-[#4A4A4A]/60 ml-auto">{formatRelative(linkage.linkedAt)}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60 mb-1">Officer</div>
          <Link
            href={`/lia/officers/${linkage.officerId}`}
            className="text-sm font-bold text-[#1E3A5F] hover:text-[#E8B923] inline-flex items-center gap-1"
          >
            View officer profile →
          </Link>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60 mb-1">Linked by</div>
          <div className="text-sm text-[#1E3A5F]">
            {linkage.linkedByName ?? '—'} · {formatDate(linkage.linkedAt)}
          </div>
        </div>
      </div>

      {linkage.note && (
        <div className="mb-3 rounded-lg bg-[#FAF8F3] p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60 mb-1">Note</div>
          <p className="text-sm text-[#1E3A5F] whitespace-pre-wrap">{linkage.note}</p>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-gray-100">
        <LinkOfficerButton caseId={caseId} />
        <UnlinkOfficerButton caseId={caseId} officerName={linkage.linkedByName ?? 'this officer'} />
      </div>
    </section>
  );
}

// PR-LIA-9 — Visa expiry banner. Renders above all other panels when
// the case has an APPROVED visa within 30 days of expiry (or past it).
// Click → /lia/expiring-soon for the full queue + reminder ledger.
function VisaExpiryBanner({ caseData }: { caseData: CaseDetail }) {
  const v = caseData.visa;
  if (!v || v.outcome !== 'APPROVED' || !v.visaEndDate) return null;
  const endMs = new Date(v.visaEndDate).getTime();
  const days = Math.floor((endMs - Date.now()) / 86_400_000);
  if (days > 30) return null;

  const expired = days < 0;
  const styles = expired
    ? 'border-red-300 bg-red-50 text-red-900'
    : days <= 7
      ? 'border-red-200 bg-red-50 text-red-900'
      : days <= 14
        ? 'border-orange-200 bg-orange-50 text-orange-900'
        : 'border-amber-200 bg-amber-50 text-amber-900';
  const icon = expired ? <XCircle size={18} /> : <AlertTriangle size={18} />;
  const message = expired
    ? `Visa expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago.`
    : `Visa expires in ${days} day${days === 1 ? '' : 's'}.`;

  return (
    <div className={`mb-6 rounded-xl border-2 px-4 py-3 flex items-start gap-2 flex-wrap ${styles}`}>
      <span className="flex-shrink-0 mt-0.5">{icon}</span>
      <p className="text-sm flex-1 min-w-0">
        <strong>{message}</strong> See the expiring-soon queue for the full reminder history.
      </p>
      <Link
        href="/lia/expiring-soon"
        className="text-xs font-semibold underline hover:no-underline whitespace-nowrap"
      >
        Open queue →
      </Link>
    </div>
  );
}

// PR-LIA-8 — Visa outcome panel.
// INZ_SUBMITTED + no visa row → two CTAs (Approve / Decline)
// COMPLETED + visa.APPROVED   → full approval record + Edit/Revert/Download
// COMPLETED + visa.DECLINED   → decline record + Edit/Revert
function VisaOutcomePanel({ caseData }: { caseData: CaseDetail }) {
  const v = caseData.visa;

  if (caseData.stage === 'INZ_SUBMITTED' && !v) {
    return (
      <div className="mb-6 rounded-xl border-2 border-[#1E3A5F]/20 bg-white p-5">
        <div className="flex items-center gap-2 mb-3">
          <Scale size={18} className="text-[#1E3A5F]" />
          <h2 className="text-base font-bold text-[#1E3A5F]">Record INZ outcome</h2>
        </div>
        <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
          INZ has decided on this submission — record the outcome below. Approval requires the visa document + start/end dates; decline requires an internal reason (not shared with the client).
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <RecordVisaApprovalButton caseId={caseData.id} />
          <RecordVisaDeclineButton caseId={caseData.id} />
        </div>
      </div>
    );
  }

  if (caseData.stage === 'COMPLETED' && v && v.outcome === 'APPROVED' && v.visaStartDate && v.visaEndDate) {
    const endMs = new Date(v.visaEndDate).getTime();
    const daysRemaining = Math.floor((endMs - Date.now()) / 86_400_000);
    return (
      <section className="mb-6 rounded-xl border border-emerald-200 bg-white p-5">
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <CheckCircle2 size={18} className="text-emerald-700" />
          <h2 className="text-base font-bold text-[#1E3A5F]">Visa Record</h2>
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 ml-1">
            APPROVED
          </span>
          <span className={`ml-auto inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${visaExpiryStyles(daysRemaining)}`}>
            {visaExpiryLabel(daysRemaining)}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60 mb-1">Valid from</div>
            <div className="text-sm text-[#1E3A5F] font-semibold">{formatDate(v.visaStartDate)}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60 mb-1">Valid until</div>
            <div className="text-sm text-[#1E3A5F] font-semibold">{formatDate(v.visaEndDate)}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60 mb-1">Days remaining</div>
            <div className="text-3xl font-bold text-[#1E3A5F] tabular-nums">{daysRemaining}</div>
          </div>
        </div>

        {v.notes && (
          <div className="mb-4 rounded-lg bg-[#FAF8F3] p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60 mb-1">Notes</div>
            <p className="text-sm text-[#1E3A5F] whitespace-pre-wrap">{v.notes}</p>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-gray-100">
          {v.visaDocumentName && (
            <DownloadVisaButton caseId={caseData.id} fileName={v.visaDocumentName} />
          )}
          <EditVisaRecordButton
            caseId={caseData.id}
            outcome="APPROVED"
            currentStart={v.visaStartDate}
            currentEnd={v.visaEndDate}
            currentDeclineReason={null}
            currentNotes={v.notes}
          />
          <RevertVisaRecordButton caseId={caseData.id} outcome="APPROVED" />
        </div>
      </section>
    );
  }

  if (caseData.stage === 'COMPLETED' && v && v.outcome === 'DECLINED') {
    return (
      <section className="mb-6 rounded-xl border border-red-200 bg-white p-5">
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <XCircle size={18} className="text-red-700" />
          <h2 className="text-base font-bold text-[#1E3A5F]">Visa Record</h2>
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-red-100 text-red-800 border border-red-200 ml-1">
            DECLINED
          </span>
          <span className="ml-auto text-xs text-[#4A4A4A]/60">
            Recorded {formatRelative(v.issuedAt)}
          </span>
        </div>

        <div className="mb-4 rounded-lg bg-red-50/60 border border-red-200 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Lock size={12} className="text-red-700/70" />
            <div className="text-xs font-semibold uppercase tracking-wider text-red-800">
              Decline reason (confidential — staff only)
            </div>
          </div>
          {v.declineReason
            ? <p className="text-sm text-[#1E3A5F] whitespace-pre-wrap leading-relaxed">{v.declineReason}</p>
            : <p className="text-sm italic text-[#4A4A4A]/60">— reason unavailable —</p>}
        </div>

        {v.notes && (
          <div className="mb-4 rounded-lg bg-[#FAF8F3] p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-[#4A4A4A]/60 mb-1">Notes</div>
            <p className="text-sm text-[#1E3A5F] whitespace-pre-wrap">{v.notes}</p>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-gray-100">
          <EditVisaRecordButton
            caseId={caseData.id}
            outcome="DECLINED"
            currentStart={null}
            currentEnd={null}
            currentDeclineReason={v.declineReason}
            currentNotes={v.notes}
          />
          <RevertVisaRecordButton caseId={caseData.id} outcome="DECLINED" />
        </div>
      </section>
    );
  }

  return null;
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

