'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Edit, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-10 — Edit-officer overlay.
// Per Decision 2C any LIA can edit the shared profile fields.
// Only observations are author-locked.

export function EditOfficerButton({
  officerId,
  currentFullName,
  currentOfficerCode,
  currentBranch,
  currentCountryOfPosting,
  currentProfileDescription,
}: {
  officerId: string;
  currentFullName: string;
  currentOfficerCode: string | null;
  currentBranch: string | null;
  currentCountryOfPosting: string | null;
  currentProfileDescription: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState(currentFullName);
  const [officerCode, setOfficerCode] = useState(currentOfficerCode ?? '');
  const [branch, setBranch] = useState(currentBranch ?? '');
  const [countryOfPosting, setCountryOfPosting] = useState(currentCountryOfPosting ?? '');
  const [profileDescription, setProfileDescription] = useState(currentProfileDescription ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameTrimmed = fullName.trim();
  const nameChanged = nameTrimmed !== currentFullName;
  const codeChanged = officerCode.trim() !== (currentOfficerCode ?? '');
  const branchChanged = branch.trim() !== (currentBranch ?? '');
  const countryChanged = countryOfPosting.trim() !== (currentCountryOfPosting ?? '');
  const descChanged = profileDescription.trim() !== (currentProfileDescription ?? '');
  const anyChange = nameChanged || codeChanged || branchChanged || countryChanged || descChanged;
  const canSubmit = anyChange && nameTrimmed.length >= 1 && !submitting;

  const close = () => {
    if (submitting) return;
    setOpen(false);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (nameChanged) body.fullName = nameTrimmed;
      if (codeChanged) body.officerCode = officerCode.trim();
      if (branchChanged) body.branch = branch.trim();
      if (countryChanged) body.countryOfPosting = countryOfPosting.trim();
      if (descChanged) body.profileDescription = profileDescription.trim();
      await api.patch(`/officers/${officerId}`, body);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to update officer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Edit officer profile"
        className="inline-flex items-center gap-1 text-[#4A4A4A] hover:text-[#E8B923] transition-colors"
      >
        <Edit size={16} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-[#1E3A5F]/10 flex items-center justify-center flex-shrink-0">
                  <Edit size={18} className="text-[#1E3A5F]" />
                </div>
                <h2 className="text-lg font-bold text-[#1E3A5F]">Edit officer profile</h2>
              </div>
              <button type="button" onClick={close} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
              These fields are shared. Any LIA can update them. Observations stay locked to their authors.
            </p>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Full name *</label>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={200} disabled={submitting}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-3" />

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Officer code</label>
            <input type="text" value={officerCode} onChange={(e) => setOfficerCode(e.target.value)} maxLength={64} disabled={submitting}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-3" />

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Branch</label>
            <input type="text" value={branch} onChange={(e) => setBranch(e.target.value)} maxLength={200} disabled={submitting}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-3" />

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Country of posting</label>
            <input type="text" value={countryOfPosting} onChange={(e) => setCountryOfPosting(e.target.value)} maxLength={120} disabled={submitting}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-3" />

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Profile description</label>
            <textarea value={profileDescription} onChange={(e) => setProfileDescription(e.target.value)} rows={4} maxLength={5000} disabled={submitting}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none resize-y disabled:bg-gray-50" />

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}
            {!anyChange && !error && (
              <p className="text-xs text-[#4A4A4A]/60 mt-3">Make a change to enable Save.</p>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={close} disabled={submitting} className="min-h-[44px] px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="min-h-[44px] px-5 py-2 rounded-xl bg-[#1E3A5F] text-white text-sm font-semibold hover:bg-[#E8B923] hover:text-[#1E3A5F] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                {submitting ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
