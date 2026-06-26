'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-FILES-2 — Per-CHILD-FILE download button. The LIA INZ viewer
// renders one of these per uploaded file under each requirement;
// the backend route now expects a child-file id (not the parent's
// id). The signed URL itself is fetched on click — never embedded
// in the payload — and opens in a new tab.

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

export function InzDocDownloadButton({
  caseId,
  kind,
  fileId,
  fileName,
}: {
  caseId: string;
  kind: 'supporting' | 'other-evidence';
  fileId: string;
  fileName: string;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setWorking(true);
    setError(null);
    try {
      const { url } = await api.get<{ url: string; expiresInSeconds: number }>(
        `/cases/${caseId}/visa-documents/${kind}/${fileId}/download-url`,
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
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-[#1E3A5F] bg-white border border-gray-200 hover:border-[#F3CE49] hover:text-[#b8941f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download size={12} /> {working ? '...' : 'Download'}
      </button>
      {error && (
        <span className="text-xs text-red-700 mt-1">{error}</span>
      )}
    </span>
  );
}

// PR-FILES-2 — subdued "No file uploaded" placeholder for
// requirements/entries with an empty files[] array. Same visual
// language as the disabled button it replaces.
export function NoFileBadge() {
  return (
    <span
      title="The client hasn't uploaded a file for this requirement yet."
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-[#4A4A4A]/50 bg-gray-100 border border-gray-200"
    >
      No file uploaded
    </span>
  );
}
