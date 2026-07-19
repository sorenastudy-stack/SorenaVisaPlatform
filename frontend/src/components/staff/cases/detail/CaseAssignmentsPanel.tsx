'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PermissionGate } from '@/components/staff/shell/PermissionGate';
import { StaffAvatar } from '@/components/staff/StaffAvatar';
import type { CaseDetail, RoleSlot } from './types';
import { ReassignOverlay } from './ReassignOverlay';

// PR-CONSULT-2 — Assignments panel.
//
// Four rows, one per slot. All four are reassignable: Case now has
// columns for every slot (liaId, ownerId, supportId, financeId).
// The Reassign button is still admin-gated via <PermissionGate
// require="canReassign">.
//
// Display-only relabel: the CONSULTANT code role is the "Admission
// Specialist" externally. The role enum stays CONSULTANT.

// LIA/SUPPORT/FINANCE labels come from the bilingual dictionary. CONSULTANT and
// CLIENT_CONSULTANT are English literals (see slotLabel) — no fa keys added.
const SLOT_I18N_KEYS: Partial<Record<RoleSlot, string>> = {
  LIA:     'staff.roles.LIA',
  SUPPORT: 'staff.roles.SUPPORT',
  FINANCE: 'staff.roles.FINANCE',
};

// PR-CLIENT-CONSULTANT-SLOT — Client Consultant (consultantId) sits next to the
// Admission Specialist (ownerId) so the two consultant-type roles are adjacent.
const SLOTS: RoleSlot[] = ['LIA', 'CONSULTANT', 'CLIENT_CONSULTANT', 'SUPPORT', 'FINANCE'];

export function CaseAssignmentsPanel({
  data,
  onChanged,
}: {
  data:      CaseDetail;
  onChanged: () => void;
}) {
  const t = useTranslations();
  const [reassigning, setReassigning] = useState<RoleSlot | null>(null);

  const slotLabel = (slot: RoleSlot): string => {
    if (slot === 'CONSULTANT') return 'Admission Specialist';
    if (slot === 'CLIENT_CONSULTANT') return 'Client Consultant';
    return t(SLOT_I18N_KEYS[slot] as string);
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-4">
        {t('staff.cases.detail.assignments')}
      </h2>
      <ul className="divide-y divide-gray-100">
        {SLOTS.map((slot) => {
          const a = data.assignments[slot];
          return (
            <li key={slot} className="py-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {a && <StaffAvatar name={a.name} photoUrl={a.photoUrl} size={32} />}
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">
                    {slotLabel(slot)}
                  </div>
                  <div className={a ? 'text-sm font-medium text-gray-900 truncate' : 'text-sm italic text-gray-400'}>
                    {a ? a.name : t('staff.cases.notAssigned')}
                  </div>
                </div>
              </div>
              <PermissionGate require="canReassign">
                <button
                  type="button"
                  onClick={() => setReassigning(slot)}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-[#1e3a5f] border border-[#1e3a5f]/30 hover:bg-[#1e3a5f]/5 transition-colors min-h-[36px]"
                >
                  {t('staff.cases.detail.reassign')}
                </button>
              </PermissionGate>
            </li>
          );
        })}
      </ul>

      {reassigning && (
        <ReassignOverlay
          caseId={data.id}
          roleSlot={reassigning}
          open={!!reassigning}
          onClose={() => setReassigning(null)}
          onDone={onChanged}
          currentAssigneeName={data.assignments[reassigning]?.name ?? null}
        />
      )}
    </section>
  );
}
