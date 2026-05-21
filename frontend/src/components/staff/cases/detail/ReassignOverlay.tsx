'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { RoleSlot, AvailableStaffRow } from './types';

// PR-CONSULT-2 — Reassign overlay.
//
// Inline modal (no shadcn Dialog primitive). Fetches the candidate
// list from /api/staff/assignments/available-staff on open, shows
// each candidate's current open-assignment count, and submits the
// chosen one to /api/staff/assignments/manual-assign. On success
// fires the parent `onDone` callback so it can refetch the case
// detail (which re-pulls the assignments panel).

export function ReassignOverlay({
  caseId,
  roleSlot,
  open,
  onClose,
  onDone,
}: {
  caseId:   string;
  roleSlot: RoleSlot;
  open:     boolean;
  onClose:  () => void;
  onDone:   () => void;
}) {
  const t = useTranslations();
  const [candidates, setCandidates] = useState<AvailableStaffRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSelectedId('');
    api
      .get<AvailableStaffRow[]>(`/api/staff/assignments/available-staff?roleSlot=${roleSlot}`)
      .then((rows) => setCandidates(rows))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load candidates'))
      .finally(() => setLoading(false));
  }, [open, roleSlot]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!selectedId) return;
    setSubmitting(true);
    try {
      await api.post('/api/staff/assignments/manual-assign', {
        caseId,
        roleSlot,
        staffId: selectedId,
      });
      toast.success('Assignment updated');
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reassign');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => (submitting ? null : onClose())}
      />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-bold text-[#1e3a5f]">
            {t('staff.cases.detail.reassignTitle', { role: roleSlot })}
          </h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {loading && (
          <div className="py-6 text-center text-sm text-gray-500">Loading candidates…</div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 mb-4">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-2 mb-6">
            {candidates.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-4">
                No eligible staff available for this slot.
              </div>
            ) : (
              candidates.map((c) => {
                const active = selectedId === c.staffId;
                return (
                  <button
                    key={c.staffId}
                    type="button"
                    onClick={() => setSelectedId(c.staffId)}
                    className={[
                      'w-full text-left rounded-xl border px-4 py-3 flex items-center justify-between transition-colors min-h-[56px]',
                      active
                        ? 'border-[#1e3a5f] bg-[#1e3a5f]/5'
                        : 'border-gray-200 hover:border-gray-300 bg-white',
                    ].join(' ')}
                  >
                    <span className="font-medium text-gray-900">{c.name || c.staffId}</span>
                    <span className="text-xs text-gray-500">
                      {t('staff.cases.detail.openAssignments', { count: c.activeAssignmentCount })}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!selectedId || submitting}
          className="w-full rounded-xl bg-[#1e3a5f] text-white font-semibold py-3 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#162d4a] transition-colors min-h-[48px]"
        >
          {submitting ? 'Saving…' : t('staff.cases.detail.reassignSubmit')}
        </button>
      </div>
    </div>
  );
}
