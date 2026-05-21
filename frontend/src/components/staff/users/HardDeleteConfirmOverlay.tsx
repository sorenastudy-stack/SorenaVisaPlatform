'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { isPendingApproval, type ActionResult } from './types';
import { notifySentForApproval } from './notify';

// PR-CONSULT-4 — Hard-delete confirmation overlay.
//
// DELETE /api/staff/users/:id. OWNER inline; SUPER_ADMIN enqueues
// HARD_DELETE_STAFF. The OWNER must type the target's full name
// exactly (case-sensitive) before the delete button enables — a
// deliberately heavy speed bump for the platform's most destructive
// op.

export function HardDeleteConfirmOverlay({
  userId,
  fullName,
  open,
  onClose,
  onDone,
}: {
  userId:   string;
  fullName: string;
  open:     boolean;
  onClose:  () => void;
  onDone:   () => void;
}) {
  const t = useTranslations();
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const matches = typed === fullName;

  const handleSubmit = async () => {
    if (!matches) return;
    setSubmitting(true);
    try {
      const result = await api.delete<ActionResult>(`/api/staff/users/${userId}`);
      if (isPendingApproval(result)) {
        notifySentForApproval(t('staff.users.sentForApproval'), t('staff.users.sentForApprovalLink'));
      } else {
        toast.success('Staff user deleted');
      }
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
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
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={18} className="text-rose-700" />
            </div>
            <h2 className="text-lg font-bold text-rose-700">
              {t('staff.users.hardDelete.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4 leading-relaxed">
          {t('staff.users.hardDelete.warning')}
        </p>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            {t('staff.users.hardDelete.confirmName', { name: fullName })}
          </label>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={fullName}
            autoComplete="off"
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 min-h-[48px]"
          />
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!matches || submitting}
          className="w-full rounded-xl bg-[#b91c1c] text-white font-semibold py-3 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#a01818] transition-colors min-h-[48px]"
        >
          {submitting ? '…' : t('staff.users.hardDelete.confirmButton')}
        </button>
      </div>
    </div>
  );
}
