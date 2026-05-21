'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { CaseHeader } from './CaseHeader';
import { CaseAssignmentsPanel } from './CaseAssignmentsPanel';
import { CaseTabs, type CaseTab } from './CaseTabs';
import { CaseOverviewTab } from './CaseOverviewTab';
import { CaseActivityTab } from './CaseActivityTab';
import { PlaceholderPanel } from '@/components/staff/PlaceholderPanel';
import type { CaseDetail } from './types';

// PR-CONSULT-2 — Case detail (client component).
//
// Owns the active tab + the case detail fetch. The Reassign overlay
// calls `refresh` after a successful submit so the assignments
// panel reflects the new assignee. The Documents / Meetings /
// Tickets tabs render a PlaceholderPanel until later PRs ship.

export function CaseDetailClient({ caseId }: { caseId: string }) {
  const t = useTranslations();
  const [data, setData] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<CaseTab>('overview');

  const refresh = useCallback(() => {
    setError(null);
    api
      .get<CaseDetail>(`/api/staff/cases/${caseId}`)
      .then((d) => setData(d))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load case'));
  }, [caseId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
          Loading case…
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10 space-y-6">
      <CaseHeader data={data} />
      <CaseAssignmentsPanel data={data} onChanged={refresh} />

      <div>
        <CaseTabs active={tab} onChange={setTab} />
        <div className="pt-5">
          {tab === 'overview'  && <CaseOverviewTab data={data} />}
          {tab === 'activity'  && <CaseActivityTab caseId={data.id} />}
          {tab === 'documents' && <PlaceholderPanel section={t('staff.cases.detail.tabs.documents')} />}
          {tab === 'meetings'  && <PlaceholderPanel section={t('staff.cases.detail.tabs.meetings')} />}
          {tab === 'tickets'   && <PlaceholderPanel section={t('staff.cases.detail.tabs.tickets')} />}
        </div>
      </div>
    </div>
  );
}
