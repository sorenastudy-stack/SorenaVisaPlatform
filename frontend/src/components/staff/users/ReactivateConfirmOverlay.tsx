'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// PR-CONSULT-3 — Reactivate confirmation overlay.
//
// POST /api/staff/users/:id/reactivate. Always executes inline
// regardless of role (non-destructive — see PR-CONSULT-1).

export function ReactivateConfirmOverlay({
  userId,
  open,
  onClose,
  onDone,
}: {
  userId:  string;
  open:    boolean;
  onClose: () => void;
  onDone:  () => void;
}) {
  const t = useTranslations();
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await api.post(`/api/staff/users/${userId}/reactivate`, {});
      toast.success('Staff reactivated');
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reactivate');
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
          <h2 className="text-lg font-bold text-emerald-700">
            {t('staff.users.detail.reactivate')}
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

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full rounded-xl bg-emerald-600 text-white font-semibold py-3 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors min-h-[48px]"
        >
          {submitting ? '…' : t('staff.users.detail.reactivate')}
        </button>
      </div>
    </div>
  );
}
