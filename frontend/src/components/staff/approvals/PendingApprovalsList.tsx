'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { StaffRoleBadge } from '@/components/staff/shell/StaffRoleBadge';
import { ApprovalPayloadPreview } from './ApprovalPayloadPreview';
import { ApprovalDecisionOverlay } from './ApprovalDecisionOverlay';
import type { ApprovalRequest } from './types';
import type { StaffRole } from '@/contexts/StaffContext';

// PR-CONSULT-3 — OWNER's "Pending" tab.
//
// Lists everything from /api/staff/owner-approval/pending. Each
// card carries enough context (requester + action type + payload
// preview + reason + relative-time submitted / expires) for the
// OWNER to decide without leaving the page. Decisions fire via
// the shared ApprovalDecisionOverlay.

const URGENT_HOURS = 24;

function isUrgent(expiresAt: string): boolean {
  const diff = new Date(expiresAt).getTime() - Date.now();
  return diff > 0 && diff < URGENT_HOURS * 60 * 60 * 1000;
}

export function PendingApprovalsList() {
  const t = useTranslations();
  const [rows, setRows] = useState<ApprovalRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<{
    request: ApprovalRequest;
    mode: 'approve' | 'reject';
  } | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    api
      .get<ApprovalRequest[]>('/api/staff/owner-approval/pending')
      .then((res) => setRows(res))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load approvals'));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  if (rows === null) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
        Loading approvals…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
        {t('staff.approvals.empty.pending')}
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-4">
        {rows.map((r) => {
          const urgent = isUrgent(r.expiresAt);
          // The requester's role isn't on the API response — but
          // SUPER_ADMIN is the only role that can enqueue, so the
          // badge is always SUPER_ADMIN here.
          return (
            <li
              key={r.id}
              className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-xs text-gray-500 mb-0.5">
                    {t('staff.approvals.requester')}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 truncate">
                      {r.requestedBy?.name ?? r.requestedById}
                    </span>
                    <StaffRoleBadge role={'SUPER_ADMIN' as StaffRole} />
                  </div>
                  {r.requestedBy?.email && (
                    <div className="text-xs text-gray-500 mt-0.5 break-all">
                      {r.requestedBy.email}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase font-bold tracking-wide text-[#1e3a5f]">
                    {t(`staff.approvals.actionType.${r.actionType}`)}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1">
                    <span>{t('staff.approvals.submitted')}: {formatRelativeTime(r.createdAt)}</span>
                  </div>
                  <div className={`text-[11px] mt-0.5 ${urgent ? 'text-rose-600 font-semibold' : 'text-gray-500'}`}>
                    {t('staff.approvals.expires')}: {formatRelativeTime(r.expiresAt)}
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                <ApprovalPayloadPreview type={r.actionType} payload={r.payload} />
              </div>

              {r.reason && (
                <div className="text-sm">
                  <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">
                    {t('staff.approvals.reason')}
                  </div>
                  <div className="text-gray-700">{r.reason}</div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDecision({ request: r, mode: 'approve' })}
                  className="flex-1 rounded-xl bg-[#F3CE49] text-[#1e3a5f] font-semibold py-3 hover:brightness-95 transition-all min-h-[48px]"
                >
                  {t('staff.approvals.approve')}
                </button>
                <button
                  type="button"
                  onClick={() => setDecision({ request: r, mode: 'reject' })}
                  className="flex-1 rounded-xl border border-rose-300 text-rose-700 font-semibold py-3 hover:bg-rose-50 transition-colors min-h-[48px]"
                >
                  {t('staff.approvals.reject')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {decision && (
        <ApprovalDecisionOverlay
          request={decision.request}
          mode={decision.mode}
          open={!!decision}
          onClose={() => setDecision(null)}
          onDone={refresh}
        />
      )}
    </>
  );
}
