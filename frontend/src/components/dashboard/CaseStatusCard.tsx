'use client';

import { useTranslations } from 'next-intl';
import { Briefcase } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatRelativeTime } from '@/lib/format-relative-time';

// PR-DASH-1 — Case status card.
//
// Shows the friendly i18n label for the current VisaCaseStatus plus
// the last-updated timestamp formatted relative to now ("2h ago",
// "yesterday", "2026-04-12"). Status colours follow the same palette
// the assessment / progress cards use — navy chip on a tinted
// background. APPROVED gets a green accent; DECLINED gets amber.
const STATUS_TINT: Record<string, string> = {
  DRAFT:                'bg-slate-100 text-slate-700',
  SUBMITTED_FOR_REVIEW: 'bg-blue-50 text-blue-700',
  REVIEWED:             'bg-indigo-50 text-indigo-700',
  READY_FOR_INZ:        'bg-amber-50 text-amber-700',
  INZ_SUBMITTED:        'bg-purple-50 text-purple-700',
  APPROVED:             'bg-emerald-50 text-emerald-700',
  DECLINED:             'bg-rose-50 text-rose-700',
};

export function CaseStatusCard({
  status,
  statusChangedAt,
}: {
  status: string;
  statusChangedAt: string;
}) {
  const t = useTranslations();
  const tint = STATUS_TINT[status] ?? STATUS_TINT.DRAFT;
  return (
    <Card className="bg-white animate-fade-in-up">
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="rounded-lg bg-[#1e3a5f]/5 p-2 text-[#1e3a5f]">
          <Briefcase size={20} />
        </div>
        <CardTitle>{t('dashboard.case.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <span
          className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-semibold ${tint}`}
        >
          {t(`dashboard.caseStatus.${status}.label` as Parameters<typeof t>[0])}
        </span>
        <p className="text-xs text-slate-500">
          {t('dashboard.case.lastUpdated', {
            when: formatRelativeTime(statusChangedAt),
          })}
        </p>
      </CardContent>
    </Card>
  );
}
