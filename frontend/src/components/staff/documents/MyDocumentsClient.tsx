'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatDate as fmtDate } from '@/lib/date';

// PR-OWNER-DOCS — cross-case document list for the Owner dashboard.
//
// GET /api/staff/case-documents returns every document the caller may see, across
// every case they may see — the server applies BOTH the case scoping (admin/LIA →
// all cases; Admission/Client Officer → their assigned cases) AND the per-document
// visibility rule (Admission Officer: P1 only, no visa; Client Officer: P1+P2, no
// visa; LIA/admin: everything). Owner/admin also get System-A "Other" documents
// (signed contracts, receipts). Download reuses the existing per-case signed-URL
// routes (structured vs System-A), which independently re-check access + audit.

interface Row {
  id:           string;
  caseId:       string;
  clientName:   string | null;
  bucket:       'STRUCTURED' | 'OTHER';
  source:       string;   // ADMISSION | APPLICATION | VISA_SUPPORTING | OTHER
  sourceRowId:  string;
  docType:      string;
  priority:     'P1' | 'P2' | null;
  fileName:     string;
  uploadedAt:   string;
  downloadable: boolean;
  reviewStatus: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  ADMISSION: 'Admission', APPLICATION: 'Application',
  VISA_SUPPORTING: 'Visa / INZ', OTHER: 'Other',
};

export function MyDocumentsClient() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    api.get<Row[]>('/api/staff/case-documents')
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load documents'));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function view(row: Row) {
    if (!row.downloadable) { toast.error('No file has been uploaded for this document yet.'); return; }
    setBusyId(row.id);
    try {
      // Structured docs use the source/rowId route; System-A "Other" docs use the
      // single-id route. Both re-check access server-side + audit the download.
      const path = row.bucket === 'OTHER'
        ? `/cases/${row.caseId}/documents/${row.sourceRowId}/download-url`
        : `/cases/${row.caseId}/documents/${row.source}/${row.sourceRowId}/download-url`;
      const { url } = await api.get<{ url: string }>(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      // A reassign-away (or a source the role can't touch) surfaces as a clean 403.
      toast.error(e instanceof Error ? e.message : 'Could not open the document.');
      refresh();
    } finally { setBusyId(null); }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10 space-y-6">
      <div className="flex items-center gap-2">
        <FileText size={20} className="text-[#1e3a5f]" />
        <h1 className="text-2xl font-bold text-[#1e3a5f]">Documents</h1>
      </div>
      <p className="-mt-3 text-sm text-gray-400">
        All documents across the cases you can see, filtered to what your role is permitted to view.
      </p>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {rows === null && !error && (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">Loading documents…</div>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-[#faf8f3] p-10 text-center">
          <FileText size={28} className="mx-auto text-[#b8941f] mb-2" />
          <p className="text-sm text-gray-500">No documents you have access to yet.</p>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100">
          {rows.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <FileText size={20} className="text-[#1e3a5f] mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate">{d.fileName}</span>
                    <SourceChip source={d.source} />
                    {d.priority && <PriorityChip priority={d.priority} />}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    <Link href={`/staff/cases/${d.caseId}`} className="font-medium text-[#1e3a5f] hover:underline">
                      {d.clientName ?? 'Case'}
                    </Link>
                    {' · '}{d.docType}{' · '}{fmtDate(d.uploadedAt)}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => view(d)}
                disabled={busyId === d.id || !d.downloadable}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-[#1e3a5f] border border-[#1e3a5f]/30 hover:bg-[#1e3a5f]/5 disabled:opacity-50 transition-colors min-h-[36px]"
              >
                {busyId === d.id ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                View
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceChip({ source }: { source: string }) {
  const visa = source === 'VISA_SUPPORTING';
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
      visa ? 'bg-[#1e3a5f]/10 text-[#1e3a5f]' : 'bg-gray-100 text-gray-500'
    }`}>
      {SOURCE_LABEL[source] ?? source}
    </span>
  );
}

function PriorityChip({ priority }: { priority: 'P1' | 'P2' }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
      priority === 'P1' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
    }`}>
      {priority}
    </span>
  );
}
