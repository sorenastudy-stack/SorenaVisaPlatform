'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { formatRelativeTime } from '@/lib/format-relative-time';

// OPS Documents — cross-case "unreviewed queue". Fetches
// GET /ops/documents/unreviewed (OPERATIONS + admin tier, enforced server-side)
// and lists every uploaded document across active cases that has no LIA verdict
// yet, oldest-first. One clear action per row: Review → the case's document area.

interface Row {
  caseId: string;
  caseReference: string | null;
  caseLabel: string;
  clientName: string | null;
  source: 'ADMISSION' | 'APPLICATION' | 'VISA_SUPPORTING';
  sourceRowId: string;
  fileName: string;
  uploaderId: string | null;
  uploaderName: string | null;
  createdAt: string;
}

const SOURCE_LABEL: Record<Row['source'], string> = {
  ADMISSION: 'Admission',
  APPLICATION: 'Application',
  VISA_SUPPORTING: 'Visa supporting',
};

export default function OpsDocumentsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get<Row[]>('/ops/documents/unreviewed').then(setRows).catch(() => setError(true));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1E3A5F] mb-1">Documents</h1>
      <p className="text-sm text-[#4A4A4A]/70 mb-8">
        Documents waiting for review across all active cases — oldest first.
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Couldn’t load the review queue. Please refresh.
        </div>
      )}

      {/* Loading */}
      {!rows && !error && (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-16 text-[#4A4A4A]/60">
            <Loader2 size={18} className="animate-spin" /> Loading…
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {rows && rows.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <CheckCircle2 size={32} className="mx-auto text-sorena-jade/50 mb-3" />
            <p className="text-[#4A4A4A] font-medium">You’re all caught up</p>
            <p className="text-sm text-[#4A4A4A]/60 mt-1">No documents waiting for review.</p>
          </CardContent>
        </Card>
      )}

      {/* Queue */}
      {rows && rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-3 px-4 font-semibold">Client</th>
                    <th className="py-3 px-4 font-semibold">Case</th>
                    <th className="py-3 px-4 font-semibold">Document</th>
                    <th className="py-3 px-4 font-semibold">Type</th>
                    <th className="py-3 px-4 font-semibold">Uploaded</th>
                    <th className="py-3 px-4 font-semibold w-0"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={`${r.source}:${r.sourceRowId}`}
                      className="border-b border-gray-50 hover:bg-[#faf8f3] transition-colors"
                    >
                      <td className="py-3 px-4 font-medium text-[#1E3A5F]">
                        {r.clientName ?? '—'}
                      </td>
                      <td className="py-3 px-4">
                        <Link
                          href={`/ops/cases/${r.caseId}`}
                          className="text-[#1E3A5F] underline underline-offset-2 hover:text-[#b8941f]"
                        >
                          {r.caseLabel}
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-[#4A4A4A]">
                        <span className="inline-flex items-center gap-1.5">
                          <FileText size={14} className="text-[#1E3A5F]/50 shrink-0" />
                          <span className="max-w-[220px] truncate">{r.fileName}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="rounded-full border border-[#c9a961]/40 bg-[#c9a961]/10 px-2 py-0.5 text-[11px] font-semibold text-[#8a6d10]">
                          {SOURCE_LABEL[r.source]}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap">
                        {formatRelativeTime(r.createdAt)}
                      </td>
                      <td className="py-3 px-4">
                        <Link
                          href={`/ops/documents/${r.caseId}?client=${encodeURIComponent(r.clientName ?? '')}`}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#1e3a5f] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#162d4a] transition-colors whitespace-nowrap"
                        >
                          Review <ArrowRight size={13} />
                        </Link>
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
