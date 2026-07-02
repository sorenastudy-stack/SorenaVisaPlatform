'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CaseStatusPill } from './CaseStatusPill';
import { formatRelativeTime } from '@/lib/format-relative-time';
import type { CaseRowApi } from './useCasesQuery';

// PR-CONSULT-2 — Cases grid (card view).
//
// 1 col mobile / 2 col tablet / 3 col desktop. Each card shows the
// student name + status pill at the top, the email below, then the
// two main assignment slots and the relative "updated" time.

export function CasesGrid({ items, basePath = '/staff/cases' }: { items: CaseRowApi[]; basePath?: string }) {
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((c) => (
        <button
          type="button"
          key={c.id}
          onClick={() => router.push(`${basePath}/${c.id}`)}
          className="text-left rounded-xl border border-gray-200 bg-white p-4 hover:border-[#1e3a5f]/40 hover:shadow-sm transition-all min-h-[160px] flex flex-col gap-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="font-bold text-[#1e3a5f] leading-tight">
              {c.studentName || '—'}
            </div>
            <CaseStatusPill status={c.status} />
          </div>
          <div className="text-xs text-gray-500 truncate">{c.studentEmail}</div>
          <div className="mt-auto space-y-1 text-xs text-gray-600 pt-3 border-t border-gray-100">
            <div className="flex justify-between gap-2">
              <span className="text-gray-400">{t('staff.cases.columns.lia')}</span>
              <span className={c.assignedLia ? '' : 'italic text-gray-400'}>
                {c.assignedLia ? c.assignedLia.name : t('staff.cases.notAssigned')}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-gray-400">{t('staff.cases.columns.consultant')}</span>
              <span className={c.assignedConsultant ? '' : 'italic text-gray-400'}>
                {c.assignedConsultant ? c.assignedConsultant.name : t('staff.cases.notAssigned')}
              </span>
            </div>
            <div className="flex justify-between gap-2 pt-1">
              <span className="text-gray-400">{t('staff.cases.columns.updated')}</span>
              <span>{formatRelativeTime(c.updatedAt)}</span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
