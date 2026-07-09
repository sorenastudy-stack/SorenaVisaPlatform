'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useStaff } from '@/contexts/StaffContext';
import { CaseHeader } from './CaseHeader';
import { CaseAssignmentsPanel } from './CaseAssignmentsPanel';
import { SendContractPanel } from './SendContractPanel';
import { CaseTabs, type CaseTab } from './CaseTabs';
import { CaseOverviewTab } from './CaseOverviewTab';
import { CaseActivityTab } from './CaseActivityTab';
import { CaseDocumentsPanel } from '@/components/cases/CaseDocumentsPanel';
import { CasePaymentsPanel } from '@/components/cases/CasePaymentsPanel';
import { PlaceholderPanel } from '@/components/staff/PlaceholderPanel';
import type { CaseDetail } from './types';

// PR-CONSULT-2 — Case detail (client component).
//
// Owns the active tab + the case detail fetch. The Reassign overlay
// calls `refresh` after a successful submit so the assignments
// panel reflects the new assignee. The Documents / Meetings /
// Tickets tabs render a PlaceholderPanel until later PRs ship.

// PR-OPS-CASES: `canEdit` forces the overview stage/notes editor on (the OPS
// detail page passes true). Omitted on the staff surface, where the editor
// falls back to admin-tier from StaffContext. The Reassign button is gated by
// <PermissionGate> and auto-hides under /ops (no StaffProvider → canReassign
// false), so no extra wiring is needed to hide it for OPS.
export function CaseDetailClient({ caseId, canEdit }: { caseId: string; canEdit?: boolean }) {
  const t = useTranslations();
  const { me } = useStaff();
  // Phase 5c (cosmetic): the CONSULTANT (Admission Specialist) is denied System A
  // attachments server-side (documents-access.helper.ts). Hide the Documents tab
  // for them so they don't hit a 403 panel. This is UX only — NOT the security
  // boundary. Their typed P1 view arrives via System B (Phase 5d).
  const isConsultant = me?.role === 'CONSULTANT';
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
      <SendContractPanel caseId={data.id} onSent={refresh} />

      <div>
        <CaseTabs active={tab} onChange={setTab} hiddenTabs={isConsultant ? ['documents'] : undefined} />
        <div className="pt-5">
          {tab === 'overview'  && <CaseOverviewTab data={data} canEdit={canEdit} onSaved={refresh} />}
          {tab === 'activity'  && <CaseActivityTab caseId={data.id} />}
          {tab === 'documents' && !isConsultant && <CaseDocumentsPanel caseId={data.id} canDelete={true} />}
          {tab === 'payments'  && <CasePaymentsPanel caseId={data.id} />}
          {tab === 'meetings'  && <PlaceholderPanel section={t('staff.cases.detail.tabs.meetings')} />}
          {tab === 'tickets'   && <PlaceholderPanel section={t('staff.cases.detail.tabs.tickets')} />}
        </div>
      </div>
    </div>
  );
}
