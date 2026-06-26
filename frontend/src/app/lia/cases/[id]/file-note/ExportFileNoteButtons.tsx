'use client';

import { useState } from 'react';
import { FileDown, FileText } from 'lucide-react';

// PR-LIA-12 — OWNER-only export buttons for the Case File Note.
//
// Renders nothing if the viewer isn't OWNER. The backend route is
// gated to OWNER anyway (defence in depth) — this just keeps the UI
// honest for everyone else.
//
// Download triggered via fetch → blob → temporary <a download> element
// rather than window.open, so the OWNER-only auth cookies travel with
// the request the same way every other api.* call does.

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

export function ExportFileNoteButtons({
  caseId,
  userRole,
}: {
  caseId: string;
  userRole: string;
}) {
  const [pending, setPending] = useState<'md' | 'txt' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (userRole !== 'OWNER') return null;

  const handleDownload = async (format: 'md' | 'txt') => {
    setPending(format);
    setError(null);
    try {
      const url = `${API_URL}/cases/${caseId}/file-note/export?format=${format}`;
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) {
        const msg = await safeReadError(res);
        throw new Error(msg || `Export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const filename = `case-${caseId}-filenote-${today}.${format}`;
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give Chrome a moment before revoking — some builds revoke too
      // eagerly before the download stream is committed.
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="rounded-xl border border-[#F3CE49]/40 bg-[#F3CE49]/10 p-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-[#1E3A5F] mb-2">
        Export (Owner-only)
      </h3>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => handleDownload('md')}
          disabled={pending !== null}
          className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg bg-[#1E3A5F] text-white text-xs font-bold px-3 py-2 hover:bg-[#F3CE49] hover:text-[#1E3A5F] transition-colors disabled:opacity-50"
        >
          <FileDown size={12} />
          {pending === 'md' ? 'Exporting…' : 'Export as Markdown'}
        </button>
        <button
          type="button"
          onClick={() => handleDownload('txt')}
          disabled={pending !== null}
          className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg bg-white border border-[#1E3A5F]/30 text-[#1E3A5F] text-xs font-bold px-3 py-2 hover:border-[#F3CE49] hover:text-[#b8941f] transition-colors disabled:opacity-50"
        >
          <FileText size={12} />
          {pending === 'txt' ? 'Exporting…' : 'Export as Text'}
        </button>
      </div>
      <p className="text-[11px] text-[#4A4A4A]/70 mt-2">
        This download is audited.
      </p>
      {error && (
        <p className="text-xs text-red-700 mt-2">{error}</p>
      )}
    </div>
  );
}

async function safeReadError(res: Response): Promise<string | null> {
  try {
    const j = await res.json();
    if (typeof j?.message === 'string') return j.message;
    if (Array.isArray(j?.message)) return j.message.join(', ');
  } catch {}
  return null;
}
