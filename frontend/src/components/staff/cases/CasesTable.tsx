'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CaseStatusPill } from './CaseStatusPill';
import { formatRelativeTime } from '@/lib/format-relative-time';
import type { CaseRowApi } from './useCasesQuery';

// PR-CONSULT-2 — Cases table.
//
// Dense desktop table view. Clicking a row routes to the case
// detail. The not-assigned slot ("Not yet assigned") gets faded
// text so the table reads scanner-friendly.

export function CasesTable({ items }: { items: CaseRowApi[] }) {
  const router = useRouter();
  const t = useTranslations();

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
        {t('staff.cases.empty')}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            <th className="px-4 py-3">{t('staff.cases.columns.student')}</th>
            <th className="px-4 py-3">{t('staff.cases.columns.email')}</th>
            <th className="px-4 py-3">{t('staff.cases.columns.status')}</th>
            <th className="px-4 py-3">{t('staff.cases.columns.lia')}</th>
            <th className="px-4 py-3">{t('staff.cases.columns.consultant')}</th>
            <th className="px-4 py-3">{t('staff.cases.columns.updated')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr
              key={c.id}
              onClick={() => router.push(`/staff/cases/${c.id}`)}
              className="border-b border-gray-100 last:border-0 cursor-pointer hover:bg-[#faf8f3] transition-colors"
            >
              <td className="px-4 py-3 font-medium text-gray-900">{c.studentName || '—'}</td>
              <td className="px-4 py-3 text-gray-600">{c.studentEmail}</td>
              <td className="px-4 py-3"><CaseStatusPill status={c.status} /></td>
              <td className={`px-4 py-3 ${c.assignedLia ? 'text-gray-700' : 'text-gray-400 italic'}`}>
                {c.assignedLia ? c.assignedLia.name : t('staff.cases.notAssigned')}
              </td>
              <td className={`px-4 py-3 ${c.assignedConsultant ? 'text-gray-700' : 'text-gray-400 italic'}`}>
                {c.assignedConsultant ? c.assignedConsultant.name : t('staff.cases.notAssigned')}
              </td>
              <td className="px-4 py-3 text-gray-500">{formatRelativeTime(c.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
