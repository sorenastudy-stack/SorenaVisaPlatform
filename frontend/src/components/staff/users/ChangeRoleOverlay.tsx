'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRoleLabel } from '@/lib/role-label';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { ASSIGNABLE_ROLES, isPendingApproval, type ActionResult } from './types';
import { notifySentForApproval } from './notify';
import type { StaffRole } from '@/contexts/StaffContext';

// PR-CONSULT-3 — Change-role overlay.
//
// PATCH /api/staff/users/:id/role with { newRole, reason? }.
// OWNER → executes inline. SUPER_ADMIN → enqueued. ADMIN never
// reaches this UI (the trigger button is gated by canManageStaff).

export function ChangeRoleOverlay({
  userId,
  currentRole,
  open,
  onClose,
  onDone,
}: {
  userId:      string;
  currentRole: StaffRole;
  open:        boolean;
  onClose:     () => void;
  onDone:      () => void;
}) {
  const t = useTranslations();
  const roleLabel = useRoleLabel();
  const [newRole, setNewRole] = useState<StaffRole | ''>('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!newRole || newRole === currentRole) return;
    setSubmitting(true);
    try {
      const result = await api.patch<ActionResult>(`/api/staff/users/${userId}/role`, {
        newRole,
        reason: reason.trim() || undefined,
      });
      if (isPendingApproval(result)) {
        notifySentForApproval(t('staff.users.sentForApproval'), t('staff.users.sentForApprovalLink'));
      } else {
        toast.success('Role updated');
      }
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change role');
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
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-bold text-[#1e3a5f]">
            {t('staff.users.detail.changeRole')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4 leading-relaxed">
          {t('staff.users.changeRole.warning')}
        </p>

        <div className="mb-4">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            {t('staff.users.form.role')}
          </label>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as StaffRole | '')}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 min-h-[48px]"
          >
            <option value="" disabled>—</option>
            {ASSIGNABLE_ROLES.filter((r) => r !== currentRole).map((r) => (
              <option key={r} value={r}>{roleLabel(r)}</option>
            ))}
          </select>
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            {t('staff.users.deactivate.reason')}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={2000}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
          />
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!newRole || submitting}
          className="w-full rounded-xl bg-[#1e3a5f] text-white font-semibold py-3 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#162d4a] transition-colors min-h-[48px]"
        >
          {submitting ? '…' : t('staff.users.detail.changeRole')}
        </button>
      </div>
    </div>
  );
}
