'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserCog, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-2 — Manual LIA reassignment overlay.
//
// Visible only to OWNER / ADMIN / SUPER_ADMIN (page-level gate).
// Pulls /staff/lia-roster on open to populate the dropdown with each
// active LIA's current open-case count. Required reason field lands
// on the audit row.

interface RosterRow {
  id: string;
  name: string;
  email: string;
  openCases: number;
}

export function ReassignLiaButton({
  caseId,
  currentLiaId,
  currentLiaName,
}: {
  caseId: string;
  currentLiaId: string | null;
  currentLiaName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(currentLiaId ?? '');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingRoster(true);
    setRosterError(null);
    api.get<RosterRow[]>('/staff/lia-roster')
      .then((rows) => { if (!cancelled) setRoster(rows ?? []); })
      .catch((e) => {
        if (cancelled) return;
        setRosterError(e instanceof ApiError ? e.message : 'Failed to load LIA roster.');
      })
      .finally(() => { if (!cancelled) setLoadingRoster(false); });
    return () => { cancelled = true; };
  }, [open]);

  const trimmedLen = reason.trim().length;
  const noChange = (selected || null) === (currentLiaId || null);
  const canSubmit =
    trimmedLen >= 10 && trimmedLen <= 500 && !noChange && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.patch(`/cases/${caseId}/lia`, {
        liaId: selected || null,
        reason: reason.trim(),
      });
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to reassign LIA.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[40px] inline-flex items-center justify-center gap-2 rounded-xl border-2 border-amber-200 bg-amber-50 text-amber-800 text-xs font-semibold px-3 py-2 hover:border-amber-400 transition-colors"
      >
        <UserCog size={14} />
        Reassign
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => (submitting ? null : setOpen(false))} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <UserCog size={18} className="text-amber-700" />
                </div>
                <h2 className="text-lg font-bold text-amber-800">Reassign LIA</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-[#4A4A4A] mb-4 leading-relaxed">
              Currently: <strong>{currentLiaName ?? 'Unassigned'}</strong>. Pick a new LIA below (numbers show their current open-case count).
            </p>

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">New LIA</label>
            {loadingRoster ? (
              <p className="text-sm text-[#4A4A4A]/60 py-2">Loading roster…</p>
            ) : rosterError ? (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 mb-3">{rosterError}</div>
            ) : (
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={submitting}
                className="w-full min-h-[48px] px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-[#1E3A5F] focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none disabled:bg-gray-50 mb-4"
              >
                <option value="">— Unassigned —</option>
                {roster.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.openCases} case{r.openCases === 1 ? '' : 's'}){r.id === currentLiaId ? ' · current' : ''}
                  </option>
                ))}
              </select>
            )}

            <label className="block text-xs font-semibold text-[#4A4A4A] mb-1">Reason (min 10 chars)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={500}
              disabled={submitting}
              placeholder="Why is this reassignment happening?"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none resize-y disabled:bg-gray-50"
            />
            <div className="text-xs text-[#4A4A4A]/60 mt-1">{trimmedLen} / 500</div>

            {noChange && trimmedLen >= 10 && (
              <p className="text-xs text-amber-700 mt-2">Pick a different LIA to apply the change.</p>
            )}

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={submitting} className="min-h-[48px] px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="min-h-[48px] px-5 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                {submitting ? '…' : 'Reassign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
