'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FilePlus2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-4 — Client-side "fulfil document request" overlay.
//
// Lists the student's already-uploaded VisaSupportingDocument rows
// (fetched via GET /students/me/visa/supporting-documents). The
// student picks one to link; the backend records the link and marks
// the request fulfilled. No new file-upload flow here — if the
// desired file isn't in the list, the student is sent to the existing
// supporting-documents page to upload it first.

interface VisaSupportingDocument {
  id: string;
  documentType: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

interface SupportingDocsResponse {
  documents?: VisaSupportingDocument[];
}

export function FulfilRequestButton({
  messageId,
  requestedDocType,
}: {
  messageId: string;
  requestedDocType: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<VisaSupportingDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<SupportingDocsResponse>('/students/me/visa/supporting-documents')
      .then((res) => {
        if (cancelled) return;
        setDocs(res.documents ?? []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'Failed to load your files.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  const pick = async (fileId: string) => {
    setSubmittingId(fileId);
    setError(null);
    try {
      await api.post(`/students/me/case-messages/${messageId}/fulfil`, { fileId });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to link the file.');
    } finally {
      setSubmittingId(null);
    }
  };

  const matchHint = requestedDocType
    ? docs.find((d) => d.documentType === requestedDocType)
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 text-white text-sm font-semibold px-4 py-2.5 hover:bg-amber-700 transition-colors"
      >
        <FilePlus2 size={16} />
        Upload / link document
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => (submittingId ? null : setOpen(false))} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <FilePlus2 size={18} className="text-amber-700" />
                </div>
                <h2 className="text-lg font-bold text-[#1E3A5F]">Choose a file to share</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={!!submittingId} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-3 leading-relaxed">
              Pick one of your already-uploaded files to share with your specialist.
              {requestedDocType && (
                <>
                  {' '}They asked for: <strong>{requestedDocType}</strong>.
                </>
              )}
            </p>

            {loading ? (
              <p className="text-sm text-[#4A4A4A]/60 py-6 text-center">Loading your files…</p>
            ) : error ? (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            ) : docs.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="mb-2">You haven&apos;t uploaded any visa supporting documents yet.</p>
                <Link href="/student/documents" className="font-semibold text-amber-800 underline">
                  Go to Visa Section to upload one first
                </Link>
              </div>
            ) : (
              <ul className="space-y-2">
                {matchHint && (
                  <li className="text-xs text-emerald-700 font-semibold mb-1">
                    ✓ Suggested match: {matchHint.documentType}
                  </li>
                )}
                {docs.map((d) => (
                  <li key={d.id} className="rounded-xl border border-gray-200 hover:border-[#1E3A5F] p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#1E3A5F]">{d.documentType}</div>
                      <div className="text-xs text-[#4A4A4A]/70 truncate">{d.originalFilename}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => pick(d.id)}
                      disabled={!!submittingId}
                      className="min-h-[44px] px-3 py-2 rounded-lg bg-[#1E3A5F] text-white text-xs font-semibold hover:bg-[#E8B923] hover:text-[#1E3A5F] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed inline-flex items-center gap-1"
                    >
                      {submittingId === d.id ? '…' : (
                        <>
                          <CheckCircle2 size={14} /> Use this file
                        </>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-[#4A4A4A]/70">
              Need to upload a different file?{' '}
              <Link href="/student/documents" className="font-semibold text-[#1E3A5F] hover:text-[#E8B923]">
                Open Visa Section →
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
