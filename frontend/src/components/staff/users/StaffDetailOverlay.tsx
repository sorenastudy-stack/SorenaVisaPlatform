'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, Check, Minus } from 'lucide-react';
import { api } from '@/lib/api';
import { useStaff } from '@/contexts/StaffContext';
import { StaffRoleBadge } from '@/components/staff/shell/StaffRoleBadge';
import { PermissionGate } from '@/components/staff/shell/PermissionGate';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { ChangeRoleOverlay } from './ChangeRoleOverlay';
import { DeactivateConfirmOverlay } from './DeactivateConfirmOverlay';
import { ReactivateConfirmOverlay } from './ReactivateConfirmOverlay';
import type { StaffUserRow } from './types';

// PR-CONSULT-3 — Staff detail overlay.
//
// Shows the user's basic fields, their workload snapshot (active
// case assignments grouped by role slot), and — gated by
// canManageStaff — the Change-role / Deactivate / Reactivate
// triggers.
//
// Self-lockout guard: OWNER cannot deactivate themselves. We hide
// the buttons rather than disabling so there's no confusing
// "why can't I click this" moment.

interface Workload {
  activeCount: number;
  byRoleSlot:  Record<'LIA' | 'CONSULTANT' | 'SUPPORT' | 'FINANCE', number>;
}

export function StaffDetailOverlay({
  user,
  open,
  onClose,
  onDone,
}: {
  user:    StaffUserRow;
  open:    boolean;
  onClose: () => void;
  onDone:  () => void;
}) {
  const t = useTranslations();
  const { me } = useStaff();
  const [workload, setWorkload] = useState<Workload | null>(null);
  const [showChangeRole, setShowChangeRole] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);
  const [showReactivate, setShowReactivate] = useState(false);

  const isSelf = me?.id === user.id;
  // Hide all destructive actions if the user is operating on themselves
  // (prevents owner self-lockout) or if their existing role is OWNER.
  const hideDestructive = isSelf || user.role === 'OWNER';

  useEffect(() => {
    if (!open) return;
    setWorkload(null);
    api
      .get<Workload>(`/api/staff/assignments/workload?staffId=${user.id}`)
      .then((w) => setWorkload(w))
      .catch(() => {
        // Non-fatal — admin tier callers can hit /workload?staffId=
        // but legacy permissions might 403. Just show "—".
      });
  }, [open, user.id]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4 gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h2 className="text-lg font-bold text-[#1e3a5f] truncate">
                {user.name || '—'}
              </h2>
              <StaffRoleBadge role={user.role} />
              <span
                className={[
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                  user.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600',
                ].join(' ')}
              >
                {user.isActive
                  ? <><Check size={12} /> Active</>
                  : <><Minus size={12} /> Inactive</>
                }
              </span>
            </div>
            <div className="text-sm text-gray-600 break-all">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 flex-shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-5">
          <dt className="text-gray-500">Created</dt>
          <dd className="text-gray-900 text-right">{formatRelativeTime(user.createdAt)}</dd>
        </dl>

        <section className="rounded-xl border border-gray-200 p-4 mb-5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">
            {t('staff.users.detail.workload')}
          </h3>
          {workload ? (
            <>
              <div className="text-sm font-medium text-[#1e3a5f] mb-2">
                {t('staff.users.detail.totalAssignments', { count: workload.activeCount })}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {(['LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE'] as const).map((slot) => (
                  <div key={slot} className="rounded-lg bg-gray-50 px-2 py-1.5 text-center">
                    <div className="text-gray-500 text-[10px] uppercase tracking-wide">{slot}</div>
                    <div className="text-gray-900 font-semibold">{workload.byRoleSlot[slot] ?? 0}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-500">—</div>
          )}
        </section>

        <PermissionGate require="canManageStaff">
          {!hideDestructive && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowChangeRole(true)}
                className="flex-1 min-w-[140px] rounded-xl border border-[#1e3a5f]/30 text-[#1e3a5f] font-semibold px-4 py-3 hover:bg-[#1e3a5f]/5 transition-colors min-h-[48px]"
              >
                {t('staff.users.detail.changeRole')}
              </button>
              {user.isActive ? (
                <button
                  type="button"
                  onClick={() => setShowDeactivate(true)}
                  className="flex-1 min-w-[140px] rounded-xl border border-rose-300 text-rose-700 font-semibold px-4 py-3 hover:bg-rose-50 transition-colors min-h-[48px]"
                >
                  {t('staff.users.detail.deactivate')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowReactivate(true)}
                  className="flex-1 min-w-[140px] rounded-xl border border-emerald-300 text-emerald-700 font-semibold px-4 py-3 hover:bg-emerald-50 transition-colors min-h-[48px]"
                >
                  {t('staff.users.detail.reactivate')}
                </button>
              )}
            </div>
          )}
        </PermissionGate>
      </div>

      <ChangeRoleOverlay
        userId={user.id}
        currentRole={user.role}
        open={showChangeRole}
        onClose={() => setShowChangeRole(false)}
        onDone={onDone}
      />
      <DeactivateConfirmOverlay
        userId={user.id}
        open={showDeactivate}
        onClose={() => setShowDeactivate(false)}
        onDone={onDone}
      />
      <ReactivateConfirmOverlay
        userId={user.id}
        open={showReactivate}
        onClose={() => setShowReactivate(false)}
        onDone={onDone}
      />
    </div>
  );
}
