'use client';

import { useTranslations } from 'next-intl';
import { Table2, LayoutGrid, Search } from 'lucide-react';

// PR-CONSULT-2 — Cases page header.
//
// One row of controls: title (left), then view-mode toggle +
// "Assigned to me" checkbox + status dropdown + search input
// (right). On mobile the row wraps; on desktop it sits in a single
// line. The view-mode toggle persists via the parent's localStorage
// hook — this component is just a controlled view.

// The list/detail endpoints filter the CaseStage column (Case.status is
// vestigial), so the dropdown offers CaseStage values — not VisaCaseStatus.
const STAGES = [
  'ADMISSION',
  'VISA',
  'INZ_SUBMITTED',
  'COMPLETED',
  'WITHDRAWN',
];

export function CasesPageHeader({
  search,
  onSearchChange,
  status,
  onStatusChange,
  assignedToMe,
  onAssignedToMeChange,
  viewMode,
  onViewModeChange,
}: {
  search:                string;
  onSearchChange:        (v: string) => void;
  status:                string;
  onStatusChange:        (v: string) => void;
  assignedToMe:          boolean;
  onAssignedToMeChange:  (v: boolean) => void;
  viewMode:              'table' | 'card';
  onViewModeChange:      (v: 'table' | 'card') => void;
}) {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-[#1e3a5f]">{t('staff.cases.title')}</h1>
        <p className="mt-1 text-sm text-[#4A4A4A]/70">Every client case — search, filter, and open one to see its stage, team, and documents.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('staff.cases.search')}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 min-h-[48px]"
          />
        </div>

        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          className="px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 min-h-[48px]"
        >
          <option value="">Stage</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>

        <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 text-sm cursor-pointer select-none min-h-[48px]">
          <input
            type="checkbox"
            checked={assignedToMe}
            onChange={(e) => onAssignedToMeChange(e.target.checked)}
            className="rounded border-gray-300 text-[#1e3a5f] focus:ring-[#1e3a5f]/30"
          />
          {t('staff.cases.assignedToMe')}
        </label>

        <div className="inline-flex rounded-xl border border-gray-200 bg-white overflow-hidden">
          <button
            type="button"
            onClick={() => onViewModeChange('table')}
            aria-pressed={viewMode === 'table'}
            className={[
              'flex items-center gap-1.5 px-3 py-2 text-sm min-h-[48px]',
              viewMode === 'table' ? 'bg-[#1e3a5f] text-white' : 'text-gray-600 hover:bg-gray-50',
            ].join(' ')}
          >
            <Table2 size={16} />
            <span className="hidden sm:inline">{t('staff.cases.viewMode.table')}</span>
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('card')}
            aria-pressed={viewMode === 'card'}
            className={[
              'flex items-center gap-1.5 px-3 py-2 text-sm min-h-[48px]',
              viewMode === 'card' ? 'bg-[#1e3a5f] text-white' : 'text-gray-600 hover:bg-gray-50',
            ].join(' ')}
          >
            <LayoutGrid size={16} />
            <span className="hidden sm:inline">{t('staff.cases.viewMode.card')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
