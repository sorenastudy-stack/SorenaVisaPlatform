'use client';

import { useTranslations } from 'next-intl';

const STEP_KEYS = [
  'admissionStep1Title',
  'admissionStep2Title',
  'admissionStep3Title',
  'admissionStep4Title',
  'admissionStep5Title',
  'admissionStep6Title',
  'admissionStep7Title',
  'admissionStep8Title',
];

export function StepPlaceholder({ step, displayStep }: { step: number; displayStep: number }) {
  const t = useTranslations();
  const key = STEP_KEYS[step - 1] ?? 'admissionStep1Title';

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sorena-navy/20 py-16 text-center">
      <p className="text-lg font-semibold text-sorena-navy">
        Step {displayStep} — {t(key)}
      </p>
      <p className="mt-2 text-sm text-sorena-navy/50">{t('comingSoon')}</p>
    </div>
  );
}
