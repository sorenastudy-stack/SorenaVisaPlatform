'use client';

import { useTranslations } from 'next-intl';
import { Check, Minus } from 'lucide-react';
import { StaffRoleBadge } from '@/components/staff/shell/StaffRoleBadge';
import { formatRelativeTime } from '@/lib/format-relative-time';
import type { StaffUserRow } from './types';

// PR-CONSULT-3 — Staff users table.
//
// Plain dense table. Rows are clickable to open the detail overlay.
// Active state renders a small green check; inactive a gray dash so
// the column scans without colour-only encoding.

export function StaffUsersTable({
  rows,
  onRowClick,
}: {
  rows:       StaffUserRow[];
  onRowClick: (u: StaffUserRow) => void;
}) {
  const t = useTranslations();

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
        {t('staff.users.empty')}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            <th className="px-4 py-3">{t('staff.users.columns.name')}</th>
            <th className="px-4 py-3">{t('staff.users.columns.email')}</th>
            <th className="px-4 py-3">{t('staff.users.columns.role')}</th>
            <th className="px-4 py-3">{t('staff.users.columns.active')}</th>
            <th className="px-4 py-3">{t('staff.users.columns.created')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr
              key={u.id}
              onClick={() => onRowClick(u)}
              className="border-b border-gray-100 last:border-0 cursor-pointer hover:bg-[#faf8f3] transition-colors"
            >
              <td className="px-4 py-3 font-medium text-gray-900">{u.name || '—'}</td>
              <td className="px-4 py-3 text-gray-600 break-all">{u.email}</td>
              <td className="px-4 py-3"><StaffRoleBadge role={u.role} /></td>
              <td className="px-4 py-3">
                {u.isActive
                  ? <Check size={16} className="text-emerald-600" />
                  : <Minus size={16} className="text-gray-400" />
                }
              </td>
              <td className="px-4 py-3 text-gray-500">{formatRelativeTime(u.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
