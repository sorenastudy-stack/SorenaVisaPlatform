'use client';

import type { StaffRole } from '@/contexts/StaffContext';
import { useRoleLabel } from '@/lib/role-label';

// PR-CONSULT-2 — Staff role pill.
//
// Color-coded by tier per the locked UI rules:
//   OWNER         → gold bg, navy text
//   SUPER_ADMIN   → navy bg, off-white text
//   ADMIN         → slate-700 bg, white text
//   everyone else → gray-100 bg, gray-800 text
//
// The label resolves through the central useRoleLabel() (the single
// staff.roles.* map) so every role — including non-staff values like LEAD /
// STUDENT that can still appear in the users list — renders a clean label and
// never a raw enum or an unresolved i18n key. `role` is typed wide (string)
// because the users endpoint returns the full UserRole enum, not just the
// staff subset.

const STYLES: Record<string, string> = {
  OWNER:       'bg-[#F3CE49] text-[#1e3a5f]',
  SUPER_ADMIN: 'bg-[#1e3a5f] text-[#faf8f3]',
  ADMIN:       'bg-slate-700 text-white',
  LIA:         'bg-gray-100 text-gray-800',
  CONSULTANT:  'bg-gray-100 text-gray-800',
  CLIENT_CONSULTANT: 'bg-gray-100 text-gray-800',
  SUPPORT:     'bg-gray-100 text-gray-800',
  FINANCE:     'bg-gray-100 text-gray-800',
};

export function StaffRoleBadge({
  role,
  size = 'sm',
}: {
  role: StaffRole | string;
  size?: 'sm' | 'md';
}) {
  const roleLabel = useRoleLabel();
  const padding = size === 'md' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[10px]';
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full font-semibold uppercase tracking-wide',
        padding,
        STYLES[role] ?? 'bg-gray-100 text-gray-800',
      ].join(' ')}
    >
      {roleLabel(role)}
    </span>
  );
}
