import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, AlertTriangle, Lock, FileText, UserCheck, Mail, Phone, Gavel, Scale, MessageSquare, FilePlus2, CheckCircle2, Files, XCircle, HelpCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { getSession } from '@/lib/auth';
import {
  riskStyles, riskLabel, stageStyles, stageLabel,
  decisionStyles, decisionLabel, docStatusStyles,
  formatDate, formatDateTime, formatRelative, formatDaysSince,
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
              <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${stageStyles(caseData.stage)}`}>
                {stageLabel(caseData.stage)}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${riskStyles(caseData.riskLevel)}`}>
                {riskLabel(caseData.riskLevel)} risk
              </span>
            </div>
          </div>
          {/* PR-LIA-6: consolidated INZ data viewer entry point. */}
          <Link
            href={`/lia/cases/${caseData.id}/inz-data`}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1E3A5F] text-white text-sm font-semibold hover:bg-[#E8B923] hover:text-[#1E3A5F] transition-colors flex-shrink-0"
          >
            <FileText size={16} /> View INZ application data →
          </Link>
        </div>
      </div>

      {/* PR-LIA-7 INZ Submission panel — three states by stage. */}
      <InzSubmissionPanel caseData={caseData} />

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

