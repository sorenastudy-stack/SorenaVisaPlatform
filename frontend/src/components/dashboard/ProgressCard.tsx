'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ClipboardCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { visaStepHref } from '@/lib/visa-step-slugs';

// PR-DASH-1 — Visa application progress card.
//
// Shows step N of 14 with a navy fill on a gray track. The primary
// action button (gold, ≥48px) routes the student back to the active
// visa step. When the application is complete (currentStep > 14) the
// button switches to "Review your application" and routes to Step 14.
export function ProgressCard({
  currentStep,
  totalSteps,
  isComplete,
}: {
  currentStep: number;
  totalSteps: number;
  isComplete: boolean;
}) {
  const t = useTranslations();
  const pct = Math.min(100, Math.max(0, Math.round((currentStep / totalSteps) * 100)));
  const targetStep = isComplete ? totalSteps : currentStep;

  return (
    <Card className="bg-white animate-fade-in-up">
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="rounded-lg bg-[#1e3a5f]/5 p-2 text-[#1e3a5f]">
          <ClipboardCheck size={20} />
        </div>
        <CardTitle>{t('dashboard.progress.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <p className="text-sm text-slate-700">
            {t('dashboard.progress.stepLabel', { current: currentStep, total: totalSteps })}
          </p>
          {isComplete && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              {t('dashboard.progress.complete')}
            </span>
          )}
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
          <div
            className="h-full rounded-full bg-[#1e3a5f] transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <Link
          href={visaStepHref(targetStep)}
          className="mt-2 inline-flex h-12 items-center justify-center rounded-xl bg-sorena-gold px-6 text-base font-semibold text-white transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sorena-gold focus-visible:ring-offset-2"
        >
          {isComplete
            ? t('dashboard.progress.review')
            : t('dashboard.progress.continue')}
        </Link>
      </CardContent>
    </Card>
  );
}
