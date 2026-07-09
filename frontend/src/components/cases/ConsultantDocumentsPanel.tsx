'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { DownloadDocumentButton } from '@/components/cases/review/DownloadDocumentButton';

// Phase 5e — READ-ONLY System B documents view for the Admission Specialist
// (role CONSULTANT). Replaces the System A attachment panel that Phase 5c hid
// for this role. It reads GET /cases/:caseId/document-reviews, which the backend
// (Phase 5d) already filters to Priority-1 (educational) rows for CONSULTANT — so
// this component does NOT do any priority logic; the server is the boundary.
//
// Download only: reuses the shared DownloadDocumentButton (the download-url mint
// is itself P2-denied server-side). There are intentionally NO approve/reject
// controls — the Admission Specialist is view-only (403 on the review routes).

interface CaseDocumentRow {
  id: string;
  source: 'ADMISSION' | 'APPLICATION' | 'VISA_SUPPORTING';
  sourceRowId: string;
  docType: string;
  fileName: string;
  uploadedAt: string;
  uploadedByName: string | null;
  downloadable: boolean;
}

const SOURCE_LABEL: Record<CaseDocumentRow['source'], string> = {
  ADMISSION: 'Admission',
  APPLICATION: 'Application',
  VISA_SUPPORTING: 'Supporting',
};

// Humanise a raw enum docType (e.g. EDUCATION_TRANSCRIPTS → "Education transcripts").
function humanizeType(docType: string): string {
  const words = docType.toLowerCase().split('_');
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

export function ConsultantDocumentsPanel({ caseId }: { caseId: string }) {
  const [rows, setRows] = useState<CaseDocumentRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<CaseDocumentRow[]>(`/cases/${caseId}/document-reviews`)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [caseId]);

  return (
    <div>
      <div className="mb-4 inline-flex items-center gap-1.5 rounded-lg bg-sorena-jade/10 px-3 py-1.5 text-xs font-medium text-sorena-jade">
        <ShieldCheck size={13} /> Educational documents only — view &amp; download
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Couldn’t load documents. Please refresh.
        </div>
      )}

      {!rows && !error && (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-14 text-[#4A4A4A]/60">
            <Loader2 size={18} className="animate-spin" /> Loading…
          </CardContent>
        </Card>
      )}

      {rows && rows.length === 0 && (
        <Card>
          <CardContent className="py-14 text-center text-sm text-[#4A4A4A]/60">
            No educational documents on this case yet.
          </CardContent>
        </Card>
      )}

      {rows && rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-3 px-4 font-semibold">Document</th>
                    <th className="py-3 px-4 font-semibold">Type</th>
                    <th className="py-3 px-4 font-semibold">Uploaded</th>
                    <th className="py-3 px-4 font-semibold w-0"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={`${d.source}:${d.sourceRowId}`} className="border-b border-gray-50">
                      <td className="py-3 px-4 text-[#4A4A4A]">
                        <span className="inline-flex items-center gap-1.5">
                          <FileText size={14} className="text-[#1E3A5F]/50 shrink-0" />
                          <span className="max-w-[240px] truncate" title={d.fileName}>{d.fileName}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-[#1E3A5F]">{humanizeType(d.docType)}</span>
                          <span className="rounded-full border border-[#c9a961]/40 bg-[#c9a961]/10 px-2 py-0.5 text-[10px] font-semibold text-[#8a6d10]">
                            {SOURCE_LABEL[d.source] ?? d.source}
                          </span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap">
                        {d.uploadedByName ? `${d.uploadedByName} · ` : ''}{formatRelativeTime(d.uploadedAt)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <DownloadDocumentButton
                          caseId={caseId}
                          source={d.source}
                          sourceRowId={d.sourceRowId}
                          downloadable={d.downloadable}
                          fileName={d.fileName}
                        />
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
