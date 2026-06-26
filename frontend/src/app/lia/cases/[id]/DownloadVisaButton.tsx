'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-8 — Fetch a signed download URL for the visa document then
// open it in a new tab. Mirrors PR-LIA-7's DownloadInzReceiptButton.

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

export function DownloadVisaButton({
  caseId,
  fileName,
}: {
  caseId: string;
  fileName: string;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setWorking(true);
    setError(null);
    try {
      const { url } = await api.get<{ url: string; expiresInSeconds: number }>(
        `/cases/${caseId}/visa/document-url`,
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
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={working}
        title={`Download ${fileName}`}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#1E3A5F] bg-white border border-gray-200 hover:border-[#F3CE49] hover:text-[#b8941f] transition-colors disabled:opacity-50"
      >
        <Download size={12} /> {working ? '…' : 'Download visa document'}
      </button>
      {error && <div className="text-xs text-red-700 mt-1">{error}</div>}
    </>
  );
}
