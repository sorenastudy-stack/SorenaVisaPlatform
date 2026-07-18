'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useStaff } from '@/contexts/StaffContext';
import { CaseHeader } from './CaseHeader';
import { CaseAssignmentsPanel } from './CaseAssignmentsPanel';
import { SendContractPanel } from './SendContractPanel';
import { CaseTabs, type CaseTab } from './CaseTabs';
import { CaseOverviewTab } from './CaseOverviewTab';
import { CaseActivityTab } from './CaseActivityTab';
import { CaseDocumentsPanel } from '@/components/cases/CaseDocumentsPanel';
import { ConsultantDocumentsPanel } from '@/components/cases/ConsultantDocumentsPanel';
import { CasePaymentsPanel } from '@/components/cases/CasePaymentsPanel';
import Link from 'next/link';
import { CalendarClock, Inbox, ArrowRight, type LucideIcon } from 'lucide-react';
import type { CaseDetail } from './types';

// PR-CONSULT-2 — Case detail (client component).
//
// Owns the active tab + the case detail fetch. The Reassign overlay
// calls `refresh` after a successful submit so the assignments
// panel reflects the new assignee. The Meetings / Tickets tabs route
// to the global Meetings / Tickets surfaces (no per-case endpoint yet).

// PR-OPS-CASES: `canEdit` forces the overview stage/notes editor on (the OPS
// detail page passes true). Omitted on the staff surface, where the editor
// falls back to admin-tier from StaffContext. The Reassign button is gated by
// <PermissionGate> and auto-hides under /ops (no StaffProvider → canReassign
// false), so no extra wiring is needed to hide it for OPS.
export function CaseDetailClient({ caseId, canEdit }: { caseId: string; canEdit?: boolean }) {
  const { me } = useStaff();
  // The CONSULTANT (Admission Specialist) is denied System A attachments
  // server-side (Phase 5c). Instead of hiding the Documents tab, Phase 5e shows
  // them a read-only System B Priority-1 view (ConsultantDocumentsPanel) — the
  // backend (Phase 5d) filters that endpoint to educational docs for this role.
  // UI only; the P1/P2 boundary is enforced server-side.
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
        <CaseTabs active={tab} onChange={setTab} />
        <div className="pt-5">
          {tab === 'overview'  && <CaseOverviewTab data={data} canEdit={canEdit} onSaved={refresh} />}
          {tab === 'activity'  && <CaseActivityTab caseId={data.id} />}
          {/* Phase 5e — CONSULTANT gets the read-only System B P1 view; every
              other role keeps the System A attachment panel (unchanged). */}
          {tab === 'documents' && (isConsultant
            ? <ConsultantDocumentsPanel caseId={data.id} />
            : <CaseDocumentsPanel caseId={data.id} canDelete={true} />)}
          {tab === 'payments'  && <CasePaymentsPanel caseId={data.id} />}
          {tab === 'meetings'  && (
            <TabPointer
              Icon={CalendarClock}
              title="Sessions are managed in Meetings"
              body="Consultation sessions aren't listed per-case yet. See your upcoming and past sessions in My Meetings."
              href="/staff/meetings"
              cta="Go to My Meetings"
            />
          )}
          {tab === 'tickets'   && (
            <TabPointer
              Icon={Inbox}
              title="Support tickets are managed in Tickets"
              body="Client support requests aren't listed per-case yet. Open the Tickets queue to find and action them."
              href="/staff/tickets"
              cta="Go to Tickets"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Honest pointer panel for tabs whose data isn't queryable per-case yet — it
// never claims "none", it routes to where that work actually lives. Replaces
// the old placeholder panel on the Meetings / Tickets tabs.
function TabPointer({
  Icon, title, body, href, cta,
}: { Icon: LucideIcon; title: string; body: string; href: string; cta: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#c9a961]/40 bg-[#faf8f3] px-6 py-12 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#c9a961]/15">
        <Icon size={26} className="text-[#b8941f]" />
      </div>
      <p className="text-lg font-bold text-[#1e3a5f]">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[#4A4A4A]/60">{body}</p>
      <Link
        href={href}
        className="mt-5 inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-[#1e3a5f] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#162d4a]"
      >
        {cta} <ArrowRight size={16} />
      </Link>
    </div>
  );
}
