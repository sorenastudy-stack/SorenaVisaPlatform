'use client';

import { useTranslations } from 'next-intl';

// PR-DASH-1 — Welcome banner at the top of the dashboard.
//
// One-line title with the student's first name, plus a status-derived
// subtitle (DRAFT / SUBMITTED_FOR_REVIEW / REVIEWED / READY_FOR_INZ /
// INZ_SUBMITTED / APPROVED / DECLINED). Status-specific copy lives in
// the `dashboard.welcome.subtitle.<STATUS>` i18n keys.
export function DashboardHeader({
  firstName,
  status,
}: {
  firstName: string;
  status: string;
}) {
  const t = useTranslations();
  return (
    <header className="mb-8 md:mb-10">
      <h1 className="text-3xl font-bold text-[#1e3a5f] md:text-4xl">
        {t('dashboard.welcome.title', { firstName: firstName || '' })}
      </h1>
      <p className="mt-2 text-base text-slate-700">
        {t(`dashboard.welcome.subtitle.${status}` as Parameters<typeof t>[0])}
      </p>
    </header>
  );
}
