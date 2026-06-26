'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, X, UserSquare2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-10 — "Add officer" overlay.
//
// Submits to POST /officers. The backend's loose duplicate check
// returns the existing officer as `duplicateHint` if a similar
// (fullName, branch) row exists — we surface it so the LIA can
// jump straight to the existing profile instead of creating noise.

interface CreateResponse {
  officer: { id: string; fullName: string };
  duplicateHint:
    | { id: string; fullName: string; branch: string | null }
    | null;
}

export function AddOfficerButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [officerCode, setOfficerCode] = useState('');
  const [branch, setBranch] = useState('');
  const [countryOfPosting, setCountryOfPosting] = useState('');
  const [profileDescription, setProfileDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateHint, setDuplicateHint] = useState<CreateResponse['duplicateHint']>(null);

  const nameTrimmed = fullName.trim();
  const canSubmit = nameTrimmed.length >= 1 && nameTrimmed.length <= 200 && !submitting;

  const reset = () => {
    setFullName('');
    setOfficerCode('');
    setBranch('');
    setCountryOfPosting('');
    setProfileDescription('');
    setError(null);
    setDuplicateHint(null);
  };

  const close = () => {
    if (submitting) return;
    setOpen(false);
    reset();
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setDuplicateHint(null);
    try {
      const res = await api.post<CreateResponse>('/officers', {
        fullName: nameTrimmed,
        officerCode: officerCode.trim() || undefined,
        branch: branch.trim() || undefined,
        countryOfPosting: countryOfPosting.trim() || undefined,
        profileDescription: profileDescription.trim() || undefined,
      });
      if (res.duplicateHint) {
        setDuplicateHint(res.duplicateHint);
      } else {
        close();
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to create officer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#F3CE49] text-[#1E3A5F] text-sm font-bold px-4 py-2 hover:bg-[#d4a615] transition-colors shadow-sm"
      >
        <Plus size={16} />
        Add officer
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-[#F3CE49]/20 flex items-center justify-center flex-shrink-0">
                  <UserSquare2 size={18} className="text-[#1E3A5F]" />
                </div>
                <h2 className="text-lg font-bold text-[#1E3A5F]">Add immigration officer</h2>
              </div>
              <button type="button" onClick={close} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
              Profile data is shared across all LIAs and editable by anyone. Observations stay attributed to their author.
            </p>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Full name *</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={200}
              disabled={submitting}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-3"
              placeholder="e.g. Jane Smith"
            />

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Officer code</label>
            <input
              type="text"
              value={officerCode}
              onChange={(e) => setOfficerCode(e.target.value)}
              maxLength={64}
              disabled={submitting}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-3"
              placeholder="INZ-internal staff ID"
            />

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Branch</label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              maxLength={200}
              disabled={submitting}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-3"
              placeholder="e.g. Auckland Central"
            />

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Country of posting</label>
            <input
              type="text"
              value={countryOfPosting}
              onChange={(e) => setCountryOfPosting(e.target.value)}
              maxLength={120}
              disabled={submitting}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-3"
              placeholder="e.g. New Zealand"
            />

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Profile description</label>
            <textarea
              value={profileDescription}
              onChange={(e) => setProfileDescription(e.target.value)}
              rows={4}
              maxLength={5000}
              disabled={submitting}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none resize-y disabled:bg-gray-50"
              placeholder="Specialty, known patterns, anything useful about this officer…"
            />

            {duplicateHint && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
                An officer named <strong>{duplicateHint.fullName}</strong>
                {duplicateHint.branch && <> at <strong>{duplicateHint.branch}</strong></>} already exists.{' '}
                <Link href={`/lia/officers/${duplicateHint.id}`} className="underline hover:no-underline font-semibold">
                  Open their profile instead?
                </Link>
              </div>
            )}

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={close} disabled={submitting} className="min-h-[44px] px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="min-h-[44px] px-5 py-2 rounded-xl bg-[#1E3A5F] text-white text-sm font-bold hover:bg-[#F3CE49] hover:text-[#1E3A5F] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                {submitting ? 'Creating…' : 'Create officer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
