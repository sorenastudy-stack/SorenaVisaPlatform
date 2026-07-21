'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { X, Check, Minus, Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useStaff } from '@/contexts/StaffContext';
import { StaffRoleBadge } from '@/components/staff/shell/StaffRoleBadge';
import { PermissionGate } from '@/components/staff/shell/PermissionGate';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { getCountryName, countryCodeToFlagEmoji } from '@/lib/country-codes';
import { ChangeRoleOverlay } from './ChangeRoleOverlay';
import { SecondaryRolesSection } from './SecondaryRolesSection';
import { DeactivateConfirmOverlay } from './DeactivateConfirmOverlay';
import { ReactivateConfirmOverlay } from './ReactivateConfirmOverlay';
import { EditStaffOverlay } from './EditStaffOverlay';
import { HardDeleteConfirmOverlay } from './HardDeleteConfirmOverlay';
import { StaffHrAdminSection } from './StaffHrAdminSection';
import type { StaffUserRow, StaffUserDetail } from './types';

// PR-CONSULT-3 — Staff detail overlay.
// PR-CONSULT-4 — extended with the new profile fields, an
// "Archived on … by …" line, an Edit-profile entry point, and a
// Hard-delete entry point gated to OWNER + SUPER_ADMIN.
//
// On open we fetch /api/staff/users/:id for the full detail (the
// list endpoint deliberately omits the encrypted profile fields).

interface Workload {
  activeCount: number;
  // Phase 2a: CLIENT_CONSULTANT is the real client Consultant slot (counted
  // from Case.consultantId, server-side).
  byRoleSlot:  Record<'LIA' | 'CONSULTANT' | 'CLIENT_CONSULTANT' | 'SUPPORT' | 'FINANCE', number>;
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
  const locale = useLocale() as 'en' | 'fa';
  const { me } = useStaff();
  const [detail, setDetail] = useState<StaffUserDetail | null>(null);
  const [workload, setWorkload] = useState<Workload | null>(null);
  const [showChangeRole, setShowChangeRole] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);
  const [showReactivate, setShowReactivate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showHardDelete, setShowHardDelete] = useState(false);

  const isSelf = me?.id === user.id;
  // PR-CONSULT-4: hide destructive actions on self (lockout guard)
  // and on any OWNER target (OWNER role rotation / archiving is
  // intentionally not in the UI; documented in the handover).
  const hideDestructive = isSelf || user.role === 'OWNER';

  // SUPER_ADMIN + OWNER can hard delete. ADMIN cannot.
  const canHardDelete = (me?.role === 'OWNER' || me?.role === 'SUPER_ADMIN') && !hideDestructive;

  const fetchDetail = useCallback(() => {
    setDetail(null);
    api.get<StaffUserDetail>(`/api/staff/users/${user.id}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [user.id]);

  useEffect(() => {
    if (!open) return;
    setWorkload(null);
    fetchDetail();
    api.get<Workload>(`/api/staff/assignments/workload?staffId=${user.id}`)
      .then(setWorkload)
      .catch(() => {});
  }, [open, user.id, fetchDetail]);

  if (!open) return null;

  const archivedDate = detail?.archivedAt
    ? new Date(detail.archivedAt).toISOString().slice(0, 10)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto">
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
                  : <><Minus size={12} /> {t('staff.users.detail.archived')}</>
                }
              </span>
            </div>
            <div className="text-sm text-gray-600 break-all">{user.email}</div>
            {!user.isActive && archivedDate && (
              <div className="text-xs text-gray-500 mt-1">
                {t('staff.users.detail.archivedOn', {
                  date:  archivedDate,
                  actor: detail?.archivedByName ?? '—',
                })}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 flex-shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        <section className="rounded-xl border border-gray-200 p-4 mb-5">
          <dl className="grid grid-cols-1 gap-y-2 text-sm">
            <Row label={t('staff.users.detail.mobile')} value={detail?.mobileNumber ?? '—'} />
            <Row
              label={t('staff.users.detail.country')}
              value={
                detail?.countryOfResidence
                  ? `${countryCodeToFlagEmoji(detail.countryOfResidence)} ${getCountryName(detail.countryOfResidence, locale)} (${detail.countryOfResidence})`
                  : '—'
              }
            />
            <Row label={t('staff.users.detail.address')} value={detail?.address ?? '—'} />
            <Row label={t('staff.users.detail.emergencyContact')} value={detail?.emergencyContact ?? '—'} />
            <Row label="Created" value={formatRelativeTime(user.createdAt)} />
          </dl>
        </section>

        {/* Secondary roles — OWNER only, never on self, never on an OWNER
            target. Widens access; the badge (primary role) above is unchanged. */}
        {me?.role === 'OWNER' && !isSelf && user.role !== 'OWNER' && detail && (
          <SecondaryRolesSection
            userId={user.id}
            primaryRole={user.role}
            initial={detail.secondaryRoles}
            onDone={() => { fetchDetail(); onDone(); }}
          />
        )}

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
                {(['LIA', 'CONSULTANT', 'CLIENT_CONSULTANT', 'SUPPORT', 'FINANCE'] as const).map((slot) => (
                  <div key={slot} className="rounded-lg bg-gray-50 px-2 py-1.5 text-center">
                    <div className="text-gray-500 text-[10px] uppercase tracking-wide">
                      {slot === 'CONSULTANT' ? 'Admission Officer' : slot === 'CLIENT_CONSULTANT' ? 'Client Officer' : slot}
                    </div>
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
          <StaffHrAdminSection
            userId={user.id}
            userName={detail?.name ?? user.name}
            photoUrl={detail?.photoUrl ?? user.photoUrl}
            onPhotoChanged={() => { fetchDetail(); onDone(); }}
          />
        </PermissionGate>

        <PermissionGate require="canManageStaff">
          <div className="space-y-2">
            {/* Edit profile is allowed even on self — staff need to fix their own details. */}
            {detail && (
              <button
                type="button"
                onClick={() => setShowEdit(true)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] text-white font-semibold px-4 py-3 hover:bg-[#162d4a] transition-colors min-h-[48px]"
              >
                <Pencil size={16} />
                {t('staff.users.detail.editProfile')}
              </button>
            )}
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
                    className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-300 text-amber-700 font-semibold px-4 py-3 hover:bg-amber-50 transition-colors min-h-[48px]"
                  >
                    <Archive size={16} />
                    {t('staff.users.detail.archive')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowReactivate(true)}
                    className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-300 text-emerald-700 font-semibold px-4 py-3 hover:bg-emerald-50 transition-colors min-h-[48px]"
                  >
                    <ArchiveRestore size={16} />
                    {t('staff.users.detail.restore')}
                  </button>
                )}
              </div>
            )}
            {canHardDelete && (
              <button
                type="button"
                onClick={() => setShowHardDelete(true)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#b91c1c] text-white font-semibold px-4 py-3 hover:bg-[#a01818] transition-colors min-h-[48px]"
              >
                <Trash2 size={16} />
                {t('staff.users.detail.hardDelete')}
              </button>
            )}
          </div>
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
      {detail && (
        <EditStaffOverlay
          detail={detail}
          open={showEdit}
          onClose={() => setShowEdit(false)}
          onDone={() => { fetchDetail(); onDone(); }}
        />
      )}
      <HardDeleteConfirmOverlay
        userId={user.id}
        fullName={user.name}
        open={showHardDelete}
        onClose={() => setShowHardDelete(false)}
        onDone={onDone}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500 flex-shrink-0">{label}</dt>
      <dd className="text-gray-900 text-right break-all whitespace-pre-wrap">{value}</dd>
    </div>
  );
}
