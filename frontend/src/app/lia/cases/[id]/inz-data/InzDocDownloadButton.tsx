'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-FILES-1 — Per-document download button rendered next to each
// row in the supporting-documents + other-evidence sections of the
// INZ data viewer. Fetches a signed URL from the inz-data backend
// (5-min TTL), then opens it in a new tab so the LIA doesn't lose
// their place on the viewer. The URL itself never enters the React
// tree — only the result of clicking is materialised, and only for
// long enough to call window.open.
//
// `hasFile=false` renders a subdued "No file uploaded" pill instead
// of a button — matches the pattern from
// frontend/src/app/lia/cases/[id]/DownloadDocumentButton.tsx where
// VISA_SUPPORTING rows used to render as "Unavailable".

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

export function InzDocDownloadButton({
  caseId,
  kind,
  docId,
  fileName,
  hasFile,
}: {
  caseId: string;
  kind: 'supporting' | 'other-evidence';
  docId: string;
  fileName: string;
  hasFile: boolean;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasFile) {
    return (
      <span
        title="The client hasn't uploaded a file for this row yet — only the metadata is on record."
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-[#4A4A4A]/50 bg-gray-100 border border-gray-200 cursor-not-allowed"
      >
        No file uploaded
      </span>
    );
  }

  const handleClick = async () => {
    setWorking(true);
    setError(null);
    try {
      const { url } = await api.get<{ url: string; expiresInSeconds: number }>(
        `/cases/${caseId}/visa-documents/${kind}/${docId}/download-url`,
      );
      const absolute = url.startsWith('http') ? url : `${API_URL}${url}`;
      window.open(absolute, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to generate download link.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={working}
        title={`Download ${fileName}`}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-[#1E3A5F] bg-white border border-gray-200 hover:border-[#E8B923] hover:text-[#E8B923] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download size={12} /> {working ? '...' : 'Download'}
      </button>
      {error && (
        <span className="text-xs text-red-700 mt-1">{error}</span>
      )}
    </span>
  );
}
