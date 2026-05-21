'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PermissionGate } from '@/components/staff/shell/PermissionGate';
import type { CaseDetail, RoleSlot } from './types';
import { ReassignOverlay } from './ReassignOverlay';

// PR-CONSULT-2 — Assignments panel.
//
// Four rows, one per slot. Each row shows the current assignee
// (or "Not yet assigned") and a "Reassign" button — but the button
// is wrapped in <PermissionGate require="canReassign"> so only
// admin tier sees it. Clicking opens the inline ReassignOverlay.

const SLOT_LABELS: Record<RoleSlot, string> = {
  LIA:        'staff.roles.LIA',
  CONSULTANT: 'staff.roles.CONSULTANT',
  SUPPORT:    'staff.roles.SUPPORT',
  FINANCE:    'staff.roles.FINANCE',
};

const SLOTS: RoleSlot[] = ['LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE'];

export function CaseAssignmentsPanel({
  data,
  onChanged,
}: {
  data:      CaseDetail;
  onChanged: () => void;
}) {
  const t = useTranslations();
  const [reassigning, setReassigning] = useState<RoleSlot | null>(null);

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
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">
                  {t(SLOT_LABELS[slot])}
                </div>
                <div className={a ? 'text-sm font-medium text-gray-900 truncate' : 'text-sm italic text-gray-400'}>
                  {a ? a.name : t('staff.cases.notAssigned')}
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
        />
      )}
    </section>
  );
}
