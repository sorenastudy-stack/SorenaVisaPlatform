'use client';

import { useTranslations } from 'next-intl';
import { useRoleLabel } from '@/lib/role-label';
import { Search, Plus } from 'lucide-react';
import { PermissionGate } from '@/components/staff/shell/PermissionGate';
import { ASSIGNABLE_ROLES } from './types';
import type { StaffRole } from '@/contexts/StaffContext';

// PR-CONSULT-3 — Staff users page header.
//
// Title + search input + role filter dropdown + Active-only toggle
// + primary "Create staff" button. The button is wrapped in
// PermissionGate require="canManageStaff" so ADMIN reads the page
// without the create affordance.

export function StaffUsersPageHeader({
  search,
  onSearchChange,
  role,
  onRoleChange,
  showArchived,
  onShowArchivedChange,
  onCreate,
}: {
  search:                string;
  onSearchChange:        (v: string) => void;
  role:                  StaffRole | '';
  onRoleChange:          (v: StaffRole | '') => void;
  showArchived:          boolean;
  onShowArchivedChange:  (v: boolean) => void;
  onCreate:              () => void;
}) {
  const t = useTranslations();
  const roleLabel = useRoleLabel();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-[#1e3a5f]">{t('staff.users.title')}</h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('staff.users.search')}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 min-h-[48px]"
          />
        </div>

        <select
          value={role}
          onChange={(e) => onRoleChange(e.target.value as StaffRole | '')}
          className="px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 min-h-[48px]"
        >
          <option value="">{t('staff.users.filter.role')}</option>
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>{roleLabel(r)}</option>
          ))}
          <option value="OWNER">{roleLabel('OWNER')}</option>
        </select>

        <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 text-sm cursor-pointer select-none min-h-[48px]">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => onShowArchivedChange(e.target.checked)}
            className="rounded border-gray-300 text-[#1e3a5f] focus:ring-[#1e3a5f]/30"
          />
          {t('staff.users.showArchived')}
        </label>

        <PermissionGate require="canManageStaff">
          <button
            type="button"
            onClick={onCreate}
            className="ml-auto inline-flex items-center gap-2 rounded-xl bg-[#1e3a5f] text-white font-semibold px-4 py-2.5 hover:bg-[#162d4a] transition-colors min-h-[48px]"
          >
            <Plus size={16} />
            {t('staff.users.create')}
          </button>
        </PermissionGate>
      </div>
    </div>
  );
}
