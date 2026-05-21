'use client';

// PR-CONSULT-2 — Visa case status pill.
//
// Color-coded by status. Status strings match the VisaCaseStatus
// Prisma enum. We render the raw status string (uppercase / snake
// case) because there's no central student-side pill to match; if
// a later PR introduces one, swap this to share that component.

const PALETTE: Record<string, string> = {
  DRAFT:                'bg-gray-100 text-gray-700',
  SUBMITTED_FOR_REVIEW: 'bg-blue-100 text-blue-700',
  REVIEWED:             'bg-indigo-100 text-indigo-700',
  READY_FOR_INZ:        'bg-amber-100 text-amber-800',
  INZ_SUBMITTED:        'bg-purple-100 text-purple-700',
  APPROVED:             'bg-emerald-100 text-emerald-700',
  DECLINED:             'bg-rose-100 text-rose-700',
};

export function CaseStatusPill({ status }: { status: string }) {
  const style = PALETTE[status] ?? 'bg-gray-100 text-gray-700';
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        style,
      ].join(' ')}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
