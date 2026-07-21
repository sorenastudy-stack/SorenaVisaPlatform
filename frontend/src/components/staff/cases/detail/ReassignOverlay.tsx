'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { RoleSlot } from './types';

// Option 1 step 3b/4c — Reassign overlay, Case-side flow for all 4 slots.
//
//   * Candidates come from GET /api/staff/cases/eligible-staff?slot=...
//     (admin-only on the staff-cases controller). Returns users with
//     role === slot, plus their open-case count on the matching Case
//     column (liaId / ownerId / supportId / financeId).
//   * Confirm writes to the slot's PATCH endpoint with the slot's body
//     key — both encoded in SLOT_CONFIG below. All four routes require
//     a reason string of 10..500 characters; the textarea below enforces
//     the minimum client-side and the backend re-checks via class-validator.

interface CaseEligibleStaff {
  id:              string;
  name:            string;
  activeCaseCount: number;
}

// Per-slot display label + PATCH endpoint + body field name. The
// CONSULTANT slot is the "Admission Specialist" externally (display
// relabel only — the code role string stays CONSULTANT and the body
// key stays ownerId because Case.ownerId is the underlying column).
const SLOT_CONFIG: Record<RoleSlot, { label: string; path: (id: string) => string; bodyKey: string }> = {
  LIA:               { label: 'Immigration Adviser',  path: (id) => `/cases/${id}/lia`,        bodyKey: 'liaId'         },
  CONSULTANT:        { label: 'Admission Officer',    path: (id) => `/cases/${id}/owner`,      bodyKey: 'ownerId'       },
  SUPPORT:           { label: 'Support',              path: (id) => `/cases/${id}/support`,    bodyKey: 'supportId'     },
  FINANCE:           { label: 'Finance',              path: (id) => `/cases/${id}/finance`,    bodyKey: 'financeId'     },
  // PR-CLIENT-CONSULTANT-SLOT — reuses the existing guarded, audited endpoint
  // PATCH /cases/:id/consultant (writes Case.consultantId; rejects non-CLIENT_CONSULTANT).
  CLIENT_CONSULTANT: { label: 'Client Officer',       path: (id) => `/cases/${id}/consultant`, bodyKey: 'consultantId' },
};

const REASON_MIN = 10;

export function ReassignOverlay({
  caseId,
  roleSlot,
  open,
  onClose,
  onDone,
  currentAssigneeName,
}: {
  caseId:   string;
  roleSlot: RoleSlot;
  open:     boolean;
  onClose:  () => void;
  onDone:   () => void;
  // PR-CLIENT-CONSULTANT-SLOT (follow-up) — the person currently in this slot, if
  // any. When set, an "Unassign" action is offered to clear the slot (all five
  // slots accept null server-side). Null/undefined → the slot is empty, so there
  // is nothing to unassign and the action is hidden.
  currentAssigneeName?: string | null;
}) {
  const [candidates, setCandidates] = useState<CaseEligibleStaff[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two-step confirm before clearing — removing a person from the case is
  // destructive, so the "Unassign" button reveals a confirm panel first.
  const [confirmingClear, setConfirmingClear] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSelectedId('');
    setReason('');
    setConfirmingClear(false);
    api
      .get<CaseEligibleStaff[]>(`/api/staff/cases/eligible-staff?slot=${roleSlot}`)
      .then((rows) => setCandidates(rows))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load candidates'))
      .finally(() => setLoading(false));
  }, [open, roleSlot]);

  if (!open) return null;

  const slotDisplay = SLOT_CONFIG[roleSlot].label;
  const reasonTrimmedLen = reason.trim().length;
  const reasonTooShort = reasonTrimmedLen < REASON_MIN;
  const canSubmit = !!selectedId && !reasonTooShort && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // The api helper hits `${API_URL}${path}` with no prefix — these
      // routes live under the operational /cases controller on the
      // backend, not under /api/staff.
      const { path, bodyKey } = SLOT_CONFIG[roleSlot];
      await api.patch(path(caseId), {
        [bodyKey]: selectedId,
        reason:   reason.trim(),
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

  // Clear the slot → same PATCH endpoint, id field set to null, same required
  // reason, audited exactly like a reassign. No candidate selection needed.
  const handleClear = async () => {
    if (reasonTooShort || submitting) return;
    setSubmitting(true);
    try {
      const { path, bodyKey } = SLOT_CONFIG[roleSlot];
      await api.patch(path(caseId), {
        [bodyKey]: null,
        reason:    reason.trim(),
      });
      toast.success('Slot cleared');
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unassign');
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
            Reassign {slotDisplay}
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
          <div className="space-y-2 mb-4">
            {candidates.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-4">
                No eligible staff available for this slot.
              </div>
            ) : (
              candidates.map((c) => {
                const active = selectedId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={[
                      'w-full text-left rounded-xl border px-4 py-3 flex items-center justify-between transition-colors min-h-[56px]',
                      active
                        ? 'border-[#1e3a5f] bg-[#1e3a5f]/5'
                        : 'border-gray-200 hover:border-gray-300 bg-white',
                    ].join(' ')}
                  >
                    <span className="font-medium text-gray-900">{c.name || c.id}</span>
                    <span className="text-xs text-gray-500">
                      {c.activeCaseCount} open
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}

        <label className="block text-xs font-semibold text-[#1e3a5f]/80 mb-1">
          Reason for reassignment <span className="text-rose-600">*</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          disabled={submitting}
          placeholder="Why is this case being reassigned? (recorded on the audit trail)"
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-[#1e3a5f] focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40 disabled:opacity-50"
        />
        <div className={['text-xs mb-4 mt-1', reasonTooShort ? 'text-rose-600' : 'text-gray-400'].join(' ')}>
          {reasonTooShort
            ? `Need at least ${REASON_MIN - reasonTrimmedLen} more character${REASON_MIN - reasonTrimmedLen === 1 ? '' : 's'}`
            : `${reasonTrimmedLen} characters`}
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full rounded-xl bg-[#1e3a5f] text-white font-semibold py-3 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#162d4a] transition-colors min-h-[48px]"
        >
          {submitting ? 'Saving…' : 'Confirm reassignment'}
        </button>

        {/* Unassign — only when someone currently holds the slot. All five slots
            accept null server-side; the same reason is required and audited. */}
        {currentAssigneeName && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            {!confirmingClear ? (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmingClear(true)}
                  disabled={submitting || reasonTooShort}
                  className="w-full rounded-xl border border-rose-200 text-rose-600 font-semibold py-3 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[48px]"
                >
                  Unassign {currentAssigneeName}
                </button>
                {reasonTooShort && (
                  <p className="mt-1 text-xs text-gray-400 text-center">
                    Add a reason above to unassign.
                  </p>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <p className="text-sm text-rose-800 mb-3">
                  Remove <span className="font-semibold">{currentAssigneeName}</span> from the{' '}
                  {slotDisplay} slot? The slot will be left unassigned. This is recorded on the
                  audit trail.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingClear(false)}
                    disabled={submitting}
                    className="flex-1 rounded-xl border border-gray-300 text-gray-600 font-semibold py-2.5 hover:bg-white disabled:opacity-50 transition-colors min-h-[44px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={submitting || reasonTooShort}
                    className="flex-1 rounded-xl bg-rose-600 text-white font-semibold py-2.5 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[44px]"
                  >
                    {submitting ? 'Removing…' : 'Confirm removal'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
