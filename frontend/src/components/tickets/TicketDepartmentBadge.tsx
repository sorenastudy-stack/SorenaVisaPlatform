'use client';

import { useTranslations } from 'next-intl';

// PR-DASH-2 — Department badge.
//
// Soft tinted bg + dark text so the badge sits quietly inside list
// rows without competing with the status badge. Each department gets
// its own Tailwind palette colour per the spec.
const DEPARTMENT_TINT: Record<string, string> = {
  ADMISSIONS:        'bg-indigo-100  text-indigo-800',
  VISA_APPLICATION:  'bg-blue-100    text-blue-800',
  DOCUMENTS:         'bg-amber-100   text-amber-800',
  PAYMENTS_FINANCE:  'bg-emerald-100 text-emerald-800',
  TECHNICAL_SUPPORT: 'bg-slate-100   text-slate-800',
  GENERAL_INQUIRY:   'bg-rose-100    text-rose-800',
};

export function TicketDepartmentBadge({ department }: { department: string }) {
  const t = useTranslations();
  const cls = DEPARTMENT_TINT[department] ?? DEPARTMENT_TINT.GENERAL_INQUIRY;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}
    >
      {t(`tickets.department.${department}` as Parameters<typeof t>[0])}
    </span>
  );
}
