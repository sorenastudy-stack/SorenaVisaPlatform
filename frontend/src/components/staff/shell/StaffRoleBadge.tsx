'use client';

import { useTranslations } from 'next-intl';
import type { StaffRole } from '@/contexts/StaffContext';

// PR-CONSULT-2 — Staff role pill.
//
// Color-coded by tier per the locked UI rules:
//   OWNER         → gold bg, navy text
//   SUPER_ADMIN   → navy bg, off-white text
//   ADMIN         → slate-700 bg, white text
//   LIA/CONSULTANT/SUPPORT/FINANCE → gray-100 bg, gray-800 text
//
// Label resolves through the staff.roles.* i18n keys so en + fa
// both work without a hardcoded English fallback.

const STYLES: Record<StaffRole, string> = {
  OWNER:       'bg-[#F3CE49] text-[#1e3a5f]',
  SUPER_ADMIN: 'bg-[#1e3a5f] text-[#faf8f3]',
  ADMIN:       'bg-slate-700 text-white',
  LIA:         'bg-gray-100 text-gray-800',
  CONSULTANT:  'bg-gray-100 text-gray-800',
  SUPPORT:     'bg-gray-100 text-gray-800',
  FINANCE:     'bg-gray-100 text-gray-800',
};

export function StaffRoleBadge({
  role,
  size = 'sm',
}: {
  role: StaffRole;
  size?: 'sm' | 'md';
}) {
  const t = useTranslations();
  const padding = size === 'md' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[10px]';
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full font-semibold uppercase tracking-wide',
        padding,
        STYLES[role] ?? 'bg-gray-100 text-gray-800',
      ].join(' ')}
    >
      {t(`staff.roles.${role}`)}
    </span>
  );
}
