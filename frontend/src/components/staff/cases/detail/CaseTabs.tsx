'use client';

import { useTranslations } from 'next-intl';

// PR-CONSULT-2 — Tab strip for the case detail page.
//
// Five tabs hard-coded into the strip; the parent owns the active
// tab state. The Documents / Meetings / Tickets tabs render a
// placeholder until later PRs build them out.

export type CaseTab = 'overview' | 'documents' | 'meetings' | 'tickets' | 'activity';

const TABS: { id: CaseTab; labelKey: string }[] = [
  { id: 'overview',  labelKey: 'staff.cases.detail.tabs.overview' },
  { id: 'documents', labelKey: 'staff.cases.detail.tabs.documents' },
  { id: 'meetings',  labelKey: 'staff.cases.detail.tabs.meetings' },
  { id: 'tickets',   labelKey: 'staff.cases.detail.tabs.tickets' },
  { id: 'activity',  labelKey: 'staff.cases.detail.tabs.activity' },
];

export function CaseTabs({
  active,
  onChange,
}: {
  active:   CaseTab;
  onChange: (tab: CaseTab) => void;
}) {
  const t = useTranslations();
  return (
    <div className="border-b border-gray-200 -mx-1 overflow-x-auto">
      <div className="flex gap-1 px-1 min-w-max">
        {TABS.map((tab) => {
          const on = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={[
                'px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors min-h-[48px]',
                on
                  ? 'border-[#c9a961] text-[#1e3a5f]'
                  : 'border-transparent text-gray-500 hover:text-[#1e3a5f]',
              ].join(' ')}
            >
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
