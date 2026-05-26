'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, X, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-10 — OWNER/SUPER_ADMIN-only officer deletion.
// Two-step confirmation: type the officer's full name to confirm.
// Handles the 409-with-linkages response gracefully.

export function DeleteOfficerButton({
  officerId,
  officerFullName,
}: {
  officerId: string;
  officerFullName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameMatches = typedName.trim() === officerFullName;
  const canSubmit = nameMatches && !submitting;

  const close = () => {
    if (submitting) return;
    setOpen(false);
    setTypedName('');
    setError(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.delete(`/officers/${officerId}`);
      router.push('/lia/officers');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete officer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs font-semibold px-3 py-1.5 hover:border-red-400 transition-colors"
      >
        <Trash2 size={12} />
        Delete officer
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={18} className="text-red-700" />
                </div>
                <h2 className="text-lg font-bold text-red-800">Delete officer</h2>
              </div>
              <button type="button" onClick={close} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-red-900 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 leading-relaxed">
              This permanently removes the officer profile and every observation attached to it. If any cases are still linked to this officer, deletion is blocked — unlink them first.
            </p>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">
              Type the officer's full name to confirm:{' '}
              <code className="bg-gray-100 text-[#1E3A5F] px-1.5 py-0.5 rounded font-mono">{officerFullName}</code>
            </label>
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              disabled={submitting}
              placeholder="Type the name exactly"
              className="w-full min-h-[44px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none disabled:bg-gray-50"
              autoComplete="off"
            />

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={close} disabled={submitting} className="min-h-[44px] px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="min-h-[44px] px-5 py-2 rounded-xl bg-red-700 text-white text-sm font-semibold hover:bg-red-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                {submitting ? 'Deleting…' : 'Delete officer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
