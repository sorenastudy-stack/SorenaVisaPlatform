'use client';

import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { downloadPdf } from '@/lib/scorecard/pdf-download';

// PR-SCORECARD-3 — Staff-side PDF download buttons.
//
// Two buttons:
//   * Internal report — long staff version with hard-stop codes,
//     gate logic, full answer log, contact summary, and staff
//     observations block.
//   * Client report — exact same PDF the applicant gets. Useful
//     for staff to preview before forwarding by email.

export function StaffScorecardPdfButtons({
  submissionId, applicantName,
}: { submissionId: string; applicantName: string }) {
  const [busy, setBusy] = useState<'internal' | 'client' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = (applicantName || 'applicant')
    .split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'applicant';

  async function download(kind: 'internal' | 'client') {
    setErr(null);
    setBusy(kind);
    try {
      const endpoint = kind === 'internal'
        ? `/staff/scorecard/${submissionId}/pdf`
        : `/scorecard/${submissionId}/pdf`;
      const filename = `sorena-${kind === 'internal' ? 'internal' : 'assessment'}-${slug}-${yyyymmdd}.pdf`;
      await downloadPdf(endpoint, filename);
    } catch {
      setErr('Could not generate PDF. Try again or check the backend logs.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={() => download('internal')}
        disabled={busy !== null}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border-2 border-[#1E3A5F] text-[#1E3A5F] text-sm font-bold hover:bg-[#1E3A5F]/5 transition-colors disabled:opacity-50"
      >
        <FileText size={13} />
        {busy === 'internal' ? 'Generating…' : 'Internal PDF'}
      </button>
      <button
        type="button"
        onClick={() => download('client')}
        disabled={busy !== null}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#1E3A5F] text-[#1E3A5F] text-sm font-medium hover:bg-[#1E3A5F]/5 transition-colors disabled:opacity-50"
      >
        <Download size={13} />
        {busy === 'client' ? 'Generating…' : 'Client PDF'}
      </button>
      {err && (
        <span className="text-xs text-red-700">{err}</span>
      )}
    </div>
  );
}
