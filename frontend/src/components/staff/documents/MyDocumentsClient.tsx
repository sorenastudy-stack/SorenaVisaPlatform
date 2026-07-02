'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatDate as fmtDate } from '@/lib/date';

// PR-STAFF-DOCS — "My case documents". Cross-case list of documents for cases
// the viewer is CURRENTLY assigned to (admin tier sees all), from
// GET /api/staff/documents. Each row downloads via the existing per-case
// download-url endpoint (presigned R2 + audited + re-checks assignment
// server-side). No upload/delete here — this is a read/download surface.

interface Row {
  id:           string;
  caseId:       string;
  originalName: string;
  mimeType:     string;
  sizeBytes:    number;
  category:     string | null;
  createdAt:    string;
  uploaderName: string | null;
  stage:        string | null;
  clientName:   string;
}

const STAGE_LABEL: Record<string, string> = {
  ADMISSION: 'Admission', VISA: 'Visa', INZ_SUBMITTED: 'INZ submitted',
  COMPLETED: 'Completed', WITHDRAWN: 'Withdrawn',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MyDocumentsClient() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    api.get<Row[]>('/api/staff/documents')
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load documents'));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function view(row: Row) {
    setBusyId(row.id);
    try {
      const { url } = await api.get<{ url: string }>(`/cases/${row.caseId}/documents/${row.id}/download-url`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      // A reassign-away since the list loaded surfaces here as a clean 403.
      toast.error(e instanceof Error ? e.message : 'Could not open the document.');
      refresh();
    } finally { setBusyId(null); }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10 space-y-6">
      <div className="flex items-center gap-2">
        <FileText size={20} className="text-[#1e3a5f]" />
        <h1 className="text-2xl font-bold text-[#1e3a5f]">My case documents</h1>
      </div>
      <p className="-mt-3 text-sm text-gray-400">Documents for the cases you’re currently assigned to.</p>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {rows === null && !error && (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">Loading documents…</div>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-[#faf8f3] p-10 text-center">
          <FileText size={28} className="mx-auto text-[#b8941f] mb-2" />
          <p className="text-sm text-gray-500">No documents on your assigned cases.</p>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100">
          {rows.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <FileText size={20} className="text-[#1e3a5f] mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{d.originalName}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    <Link href={`/staff/cases/${d.caseId}`} className="font-medium text-[#1e3a5f] hover:underline">
                      {d.clientName}
                    </Link>
                    {d.stage ? ` · ${STAGE_LABEL[d.stage] ?? d.stage}` : ''} · {formatSize(d.sizeBytes)} · {d.uploaderName ?? '—'} · {fmtDate(d.createdAt)}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => view(d)}
                disabled={busyId === d.id}
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
