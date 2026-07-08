import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, FileText, CheckCircle2 } from 'lucide-react';
import { getSession } from '@/lib/auth';
import { apiServer } from '@/lib/apiServer';
import { Card, CardContent } from '@/components/ui/Card';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { ReviewDocumentButton } from '@/components/cases/review/ReviewDocumentButton';
import { DownloadDocumentButton } from '@/components/cases/review/DownloadDocumentButton';

// OPS admission-document review — one case. Server component so a verdict's
// router.refresh() re-fetches the list (same pattern as the LIA case detail).
// Gated to OPERATIONS + admin tier by this check AND the /ops layout; the
// backend additionally strips VISA_SUPPORTING for OPERATIONS, so this surface
// only ever shows ADMISSION / APPLICATION documents. Verdicts post through the
// shared ReviewDocumentButton (backend enforces per-source access by JWT role).

const ALLOWED = new Set(['OPERATIONS', 'ADMIN', 'SUPER_ADMIN', 'OWNER']);
const ADMISSION_SOURCES = new Set(['ADMISSION', 'APPLICATION']);

interface CaseDocumentRow {
  id: string;
  source: 'ADMISSION' | 'APPLICATION' | 'VISA_SUPPORTING';
  sourceRowId: string;
  docType: string;
  fileName: string;
  uploadedAt: string;
  downloadable: boolean;
  liaReviewStatus: 'UNREVIEWED' | 'APPROVED' | 'REJECTED';
  liaReviewReason: string | null;
  liaReviewedByName: string | null;
}

const SOURCE_LABEL: Record<string, string> = { ADMISSION: 'Admission', APPLICATION: 'Application' };

function StatusBadge({ status }: { status: CaseDocumentRow['liaReviewStatus'] }) {
  const cfg =
    status === 'APPROVED'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : status === 'REJECTED'
      ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-gray-100 text-gray-500 border-gray-200';
  const label = status === 'UNREVIEWED' ? 'Unreviewed' : status === 'APPROVED' ? 'Approved' : 'Rejected';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cfg}`}>{label}</span>
  );
}

export default async function OpsCaseDocumentsReviewPage({
  params,
  searchParams,
}: {
  params: { caseId: string };
  searchParams?: { client?: string };
}) {
  const session = await getSession();
  if (!session) redirect(`/login?next=/ops/documents/${params.caseId}`);
  if (!ALLOWED.has(session.role)) redirect('/unauthorized');

  let rows: CaseDocumentRow[] = [];
  let loadError = false;
  try {
    rows = await apiServer.get<CaseDocumentRow[]>(`/cases/${params.caseId}/document-reviews`);
  } catch {
    loadError = true;
  }
  // Belt-and-suspenders: the backend already excludes VISA_SUPPORTING for OPS,
  // but we also filter here so this surface can never render a visa row.
  const docs = rows.filter((r) => ADMISSION_SOURCES.has(r.source));
  const clientName = searchParams?.client?.trim();

  return (
    <div>
      <Link
        href="/ops/documents"
        className="inline-flex items-center gap-1.5 text-sm text-[#1E3A5F]/70 hover:text-[#1E3A5F] transition-colors mb-4"
      >
        <ArrowLeft size={16} /> Back to review queue
      </Link>

      <h1 className="text-2xl font-bold text-[#1E3A5F] mb-1">
        Admission documents{clientName ? ` — ${clientName}` : ''}
      </h1>
      <p className="text-sm text-[#4A4A4A]/70 mb-8">
        Approve or reject each document. Visa documents are reviewed by the LIA team and are not shown here.
      </p>

      {loadError && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Couldn’t load this case’s documents. Please refresh.
        </div>
      )}

      {!loadError && docs.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <CheckCircle2 size={32} className="mx-auto text-sorena-jade/50 mb-3" />
            <p className="text-[#4A4A4A] font-medium">Nothing to review</p>
            <p className="text-sm text-[#4A4A4A]/60 mt-1">
              No admission documents on this case are waiting for a verdict.
            </p>
          </CardContent>
        </Card>
      )}

      {docs.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-3 px-4 font-semibold">Document</th>
                    <th className="py-3 px-4 font-semibold">Type</th>
                    <th className="py-3 px-4 font-semibold">Uploaded</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold w-0"></th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={`${d.source}:${d.sourceRowId}`} className="border-b border-gray-50">
                      <td className="py-3 px-4 text-[#4A4A4A]">
                        <span className="inline-flex items-center gap-1.5">
                          <FileText size={14} className="text-[#1E3A5F]/50 shrink-0" />
                          <span className="max-w-[240px] truncate" title={d.fileName}>{d.fileName}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="rounded-full border border-[#c9a961]/40 bg-[#c9a961]/10 px-2 py-0.5 text-[11px] font-semibold text-[#8a6d10]">
                          {SOURCE_LABEL[d.source] ?? d.source}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap">
                        {formatRelativeTime(d.uploadedAt)}
                      </td>
                      <td className="py-3 px-4"><StatusBadge status={d.liaReviewStatus} /></td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-2">
                          <DownloadDocumentButton
                            caseId={params.caseId}
                            source={d.source}
                            sourceRowId={d.sourceRowId}
                            downloadable={d.downloadable}
                            fileName={d.fileName}
                          />
                          <ReviewDocumentButton
                            caseId={params.caseId}
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
