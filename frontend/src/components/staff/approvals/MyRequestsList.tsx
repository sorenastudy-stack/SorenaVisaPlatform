'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { ApprovalPayloadPreview } from './ApprovalPayloadPreview';
import { ApprovalStatusPill } from './ApprovalStatusPill';
import type { ApprovalRequest } from './types';

// PR-CONSULT-3 — SUPER_ADMIN's "My Requests" tab.
//
// Read-only — once an SUPER_ADMIN enqueues a request, the only way
// to act on it is via the OWNER's Pending tab. This view exists so
// the requester can see whether their request has been approved /
// rejected / expired / executed, and read the OWNER's decision note.

export function MyRequestsList() {
  const t = useTranslations();
  const [rows, setRows] = useState<ApprovalRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api
      .get<ApprovalRequest[]>('/api/staff/owner-approval/mine')
      .then((res) => setRows(res))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load requests'));
  }, []);

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
        Loading requests…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
        {t('staff.approvals.empty.mine')}
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {rows.map((r) => (
        <li
          key={r.id}
          className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3"
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-xs uppercase font-bold tracking-wide text-[#1e3a5f]">
                {t(`staff.approvals.actionType.${r.actionType}`)}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                {t('staff.approvals.submitted')}: {formatRelativeTime(r.createdAt)}
              </div>
            </div>
            <ApprovalStatusPill status={r.status} />
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

          {r.decidedAt && (
            <div className="text-sm border-t border-gray-100 pt-3">
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">
                Decision
              </div>
              <div className="text-gray-500 text-[11px]">{formatRelativeTime(r.decidedAt)}</div>
              {r.decisionNote && <div className="text-gray-700 mt-1">{r.decisionNote}</div>}
              {r.executionError && (
                <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-rose-700 text-xs break-all">
                  {r.executionError}
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
