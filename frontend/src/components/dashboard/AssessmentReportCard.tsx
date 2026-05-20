'use client';

import { useTranslations } from 'next-intl';
import { GraduationCap, Hourglass } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

// PR-DASH-1 — AI assessment report card.
//
// Two states:
//   * hasReport=false → placeholder with a Hourglass icon and the
//     "results will appear here" copy. This is the default until the
//     Friday AI bot posts a real report via webhook.
//   * hasReport=true  → score (big number), band, route, summary
//     narrative (decrypted server-side), and a placeholder "View full
//     report" button that's disabled with a "Coming soon" tooltip —
//     the full report view is a future PR.
export interface AssessmentReportData {
  hasReport: boolean;
  score?: number | null;
  band?: number | null;
  route?: string | null;
  summaryNarrative?: string | null;
}

export function AssessmentReportCard({ report }: { report: AssessmentReportData }) {
  const t = useTranslations();
  return (
    <Card className="bg-white animate-fade-in-up">
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="rounded-lg bg-[#1e3a5f]/5 p-2 text-[#1e3a5f]">
          <GraduationCap size={20} />
        </div>
        <CardTitle>{t('dashboard.assessmentReport.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {!report.hasReport ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center text-slate-600">
            <Hourglass size={36} className="text-[#1e3a5f]/60" />
            <p className="text-sm">{t('dashboard.assessmentReport.placeholder')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-baseline gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t('dashboard.assessmentReport.score')}
                </p>
                <p className="text-4xl font-bold text-[#1e3a5f]">{report.score ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t('dashboard.assessmentReport.band')}
                </p>
                <p className="text-2xl font-bold text-[#1e3a5f]">
                  {report.band ?? '—'}
                </p>
              </div>
            </div>
            {report.route && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t('dashboard.assessmentReport.route')}
                </p>
                <p className="text-base text-slate-800">{report.route}</p>
              </div>
            )}
            {report.summaryNarrative && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t('dashboard.assessmentReport.summary')}
                </p>
                <p className="mt-1 text-sm text-slate-700">{report.summaryNarrative}</p>
              </div>
            )}
            <button
              type="button"
              disabled
              title={t('dashboard.assessmentReport.comingSoon')}
              className="mt-2 inline-flex h-12 cursor-not-allowed items-center justify-center rounded-xl border border-[#1e3a5f]/20 px-6 text-sm font-semibold text-[#1e3a5f]/50"
            >
              {t('dashboard.assessmentReport.viewFull')}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
