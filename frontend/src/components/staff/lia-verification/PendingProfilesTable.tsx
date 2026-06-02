'use client';

import { ArrowRight, ShieldCheck, FileText, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import type { PendingProfileRow } from './LiaVerificationPageClient';

// PR-DOCUSIGN-1 step 3 (Screen B) — pending-verification list.
//
// Mirrors the table styling used by /lia/cases (cream-tinted header,
// hover row, divide-y rows) so the staff portal stays visually
// coherent. Mobile collapses the row into a stacked list.

export function PendingProfilesTable({
  rows,
  onRowClick,
}: {
  rows: PendingProfileRow[];
  onRowClick: (row: PendingProfileRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <ShieldCheck size={32} className="mx-auto text-sorena-navy/30 mb-3" />
          <p className="text-sorena-navy font-medium">No LIAs awaiting verification</p>
          <p className="text-sm text-[#4A4A4A]/60 mt-1">
            When an LIA submits their licence, they'll appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#FAF8F3] text-[#4A4A4A]/70 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">LIA</th>
                <th className="px-4 py-3 text-left">Licence #</th>
                <th className="px-4 py-3 text-left">File</th>
                <th className="px-4 py-3 text-left">Uploaded</th>
                <th className="px-4 py-3 text-left">Prior rejections</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr
                  key={r.profileId}
                  className="hover:bg-[#FAF8F3] cursor-pointer"
                  onClick={() => onRowClick(r)}
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold text-sorena-navy">{r.userName}</div>
                    <div className="text-xs text-[#4A4A4A]/60 mt-0.5">{r.userEmail}</div>
                  </td>
                  <td className="px-4 py-3 text-[#4A4A4A] font-mono">{r.iaaLicenceNumber}</td>
                  <td className="px-4 py-3 text-[#4A4A4A]">
                    <div className="flex items-center gap-1.5">
                      <FileText size={14} className="text-[#4A4A4A]/60 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm truncate max-w-[220px]">{r.iaaLicenceFileName}</div>
                        <div className="text-xs text-[#4A4A4A]/60">
                          {formatBytes(r.iaaLicenceSizeBytes)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#4A4A4A]/80 text-xs">
                    {formatRelative(r.uploadedAt)}
                  </td>
                  <td className="px-4 py-3">
                    {r.priorRejections > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                        <AlertTriangle size={12} /> {r.priorRejections}
                      </span>
                    ) : (
                      <span className="text-xs text-[#4A4A4A]/50">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-sorena-navy">
                      Review <ArrowRight size={14} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="md:hidden divide-y divide-gray-100">
          {rows.map((r) => (
            <li
              key={r.profileId}
              className="p-4 hover:bg-[#FAF8F3] cursor-pointer"
              onClick={() => onRowClick(r)}
            >
              <div className="font-semibold text-sorena-navy">{r.userName}</div>
              <div className="text-xs text-[#4A4A4A]/60 mt-0.5">{r.userEmail}</div>
              <div className="text-xs text-[#4A4A4A]/70 mt-2 flex items-center gap-2 flex-wrap">
                <span className="font-mono">{r.iaaLicenceNumber}</span>
                <span>·</span>
                <span className="truncate max-w-[140px]">{r.iaaLicenceFileName}</span>
                <span>·</span>
                <span>{formatRelative(r.uploadedAt)}</span>
                {r.priorRejections > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">
                    <AlertTriangle size={10} /> {r.priorRejections}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}
