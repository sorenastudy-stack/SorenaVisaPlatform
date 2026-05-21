'use client';

import { useTranslations } from 'next-intl';
import type { ApprovalStatus } from './types';

// PR-CONSULT-3 — Approval status pill.

const PALETTE: Record<ApprovalStatus, string> = {
  PENDING:          'bg-amber-100 text-amber-800',
  APPROVED:         'bg-emerald-100 text-emerald-700',
  REJECTED:         'bg-rose-100 text-rose-700',
  EXPIRED:          'bg-gray-200 text-gray-700',
  EXECUTED:         'bg-emerald-100 text-emerald-800',
  EXECUTION_FAILED: 'bg-rose-200 text-rose-800',
};

export function ApprovalStatusPill({ status }: { status: ApprovalStatus }) {
  const t = useTranslations();
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        PALETTE[status] ?? 'bg-gray-100 text-gray-700',
      ].join(' ')}
    >
      {t(`staff.approvals.status.${status}`)}
    </span>
  );
}
