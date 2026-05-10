'use client';

import { useTranslations } from 'next-intl';

const STAGES = [
  { key: 'admissionStage1', minStep: 1, maxStep: 2 },
  { key: 'admissionStage2', minStep: 3, maxStep: 4 },
  { key: 'admissionStage3', minStep: 5, maxStep: 6 },
  { key: 'admissionStage4', minStep: 7, maxStep: 8 },
];

export function StageProgressBar({ currentStep }: { currentStep: number }) {
  const t = useTranslations();

  return (
    <div className="flex gap-3">
      {STAGES.map((stage) => {
        const isActive = currentStep >= stage.minStep && currentStep <= stage.maxStep;
        const isDone   = currentStep > stage.maxStep;

        return (
          <div key={stage.key} className="flex-1">
            <div className={[
              'mb-1 h-1.5 rounded-full',
              isDone ? 'bg-sorena-gold' : isActive ? 'bg-sorena-navy' : 'bg-sorena-navy/10',
            ].join(' ')} />
            <span className={[
              'text-xs',
              isActive ? 'font-medium text-sorena-navy' : 'text-sorena-navy/40',
            ].join(' ')}>
              {t(stage.key)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
