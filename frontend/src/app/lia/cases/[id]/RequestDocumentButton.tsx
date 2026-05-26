'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FilePlus2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-4 — Request document overlay. POST /cases/:id/messages/document-request.
//
// Common types are pre-populated in the dropdown but the LIA can
// override with free text (e.g. for an ad-hoc evidence request).

const COMMON_DOC_TYPES = [
  'PASSPORT_COPY',
  'BANK_STATEMENT',
  'OFFER_LETTER',
  'IELTS_RESULT',
  'TRANSCRIPTS',
  'CV',
  'POLICE_CERTIFICATE',
  'MEDICAL_CERTIFICATE',
  'SPONSOR_LETTER',
  'OTHER',
];

export function RequestDocumentButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [docTypeChoice, setDocTypeChoice] = useState<string>('PASSPORT_COPY');
  const [customDocType, setCustomDocType] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveDocType =
    docTypeChoice === 'OTHER' ? customDocType.trim() : docTypeChoice;
  const trimmedLen = body.trim().length;
  const canSubmit =
    trimmedLen >= 10 &&
    trimmedLen <= 5000 &&
    effectiveDocType.length > 0 &&
    effectiveDocType.length <= 100 &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/cases/${caseId}/messages/document-request`, {
        body: body.trim(),
        requestedDocType: effectiveDocType,
      });
      setOpen(false);
      setBody('');
      setDocTypeChoice('PASSPORT_COPY');
      setCustomDocType('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to send request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border-2 border-amber-200 bg-amber-50 text-amber-800 text-sm font-semibold px-4 py-2.5 hover:border-amber-400 transition-colors"
      >
        <FilePlus2 size={16} />
        Request document
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => (submitting ? null : setOpen(false))} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <FilePlus2 size={18} className="text-amber-700" />
                </div>
                <h2 className="text-lg font-bold text-amber-800">Request a document</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
              The client will be prompted on their dashboard to link an existing supporting document.
            </p>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Document type</label>
            <select
              value={docTypeChoice}
              onChange={(e) => setDocTypeChoice(e.target.value)}
              disabled={submitting}
              className="w-full min-h-[48px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-[#1E3A5F] focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-3"
            >
              {COMMON_DOC_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            {docTypeChoice === 'OTHER' && (
              <input
                type="text"
                value={customDocType}
                onChange={(e) => setCustomDocType(e.target.value)}
                disabled={submitting}
                maxLength={100}
                placeholder="Custom document type (e.g. RENTAL_AGREEMENT)"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-3 min-h-[48px]"
              />
            )}

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Message (min 10 chars)</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              maxLength={5000}
              disabled={submitting}
              placeholder="Explain what's needed and why…"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none resize-y disabled:bg-gray-50"
            />
            <div className="text-xs text-[#4A4A4A]/60 mt-1">{trimmedLen} / 5000</div>

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={submitting} className="min-h-[48px] px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="min-h-[48px] px-5 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                {submitting ? '…' : 'Send request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
