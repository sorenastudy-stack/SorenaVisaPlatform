'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-5 — Fetches a signed download URL on click, then redirects
// the browser to it. The URL is direct to object storage (via the
// /files/signed/:token route); no Next.js proxy.
//
// Disabled when `downloadable=false` (e.g. VisaSupportingDocument
// rows where bytes were never collected). Tooltip clarifies why.

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

export function DownloadDocumentButton({
  caseId,
  source,
  sourceRowId,
  downloadable,
  fileName,
}: {
  caseId: string;
  source: 'ADMISSION' | 'APPLICATION' | 'VISA_SUPPORTING';
  sourceRowId: string;
  downloadable: boolean;
  fileName: string;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!downloadable) {
    return (
      <span
        title="Bytes were never collected for this document (metadata-only upload). Ask the client to re-upload via the messaging channel if you need the file."
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#4A4A4A]/50 bg-gray-100 border border-gray-200 cursor-not-allowed"
      >
        <Download size={12} /> Unavailable
      </span>
    );
  }

  const handleClick = async () => {
    setWorking(true);
    setError(null);
    try {
      const { url } = await api.get<{ url: string; expiresInSeconds: number }>(
        `/cases/${caseId}/documents/${source}/${sourceRowId}/download-url`,
      );
      // The URL we get back is a relative path on the backend.
      // Resolve via the same API_URL the rest of the frontend uses.
      const absolute = url.startsWith('http') ? url : `${API_URL}${url}`;
      // Open in a new tab so the LIA doesn't lose their place on the
      // case-detail page. The browser handles the download/inline view.
      window.open(absolute, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to generate download link.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={working}
        title={`Download ${fileName}`}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#1E3A5F] bg-white border border-gray-200 hover:border-[#F3CE49] hover:text-[#b8941f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download size={12} /> {working ? '…' : 'Download'}
      </button>
      {error && (
        <div className="text-xs text-red-700 mt-1">{error}</div>
      )}
    </>
  );
}
