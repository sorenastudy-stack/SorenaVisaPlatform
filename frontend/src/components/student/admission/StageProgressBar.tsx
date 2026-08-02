'use client';

import { useTranslations } from 'next-intl';

// PR-ADMISSION-CVDATA (step 2a) — step→stage membership (explicit sets, not min/max ranges)
// so the out-of-sequence Employment step (internal id 9) maps cleanly into Stage 2 alongside
// Education (3) and Documents (4).
const STAGES: { key: string; steps: number[] }[] = [
  { key: 'admissionStage1', steps: [1, 2] },
  { key: 'admissionStage2', steps: [3, 9, 4] },
  { key: 'admissionStage3', steps: [5, 6] },
  { key: 'admissionStage4', steps: [7, 8] },
];

export function StageProgressBar({ currentStep }: { currentStep: number }) {
  const t = useTranslations();
  // 0-based index of the stage the current step belongs to (fallback 0).
  const currentStageIdx = Math.max(0, STAGES.findIndex((s) => s.steps.includes(currentStep)));

  return (
    <div className="flex gap-3">
      {STAGES.map((stage, i) => {
        const isActive = i === currentStageIdx;
        const isDone   = i < currentStageIdx;

        return (
          <div key={stage.key} className="flex-1">
            <div className={[
              'mb-1 h-1.5 rounded-full',
              isDone ? 'bg-[#c9a961]' : isActive ? 'bg-sorena-navy' : 'bg-sorena-navy/10',
            ].join(' ')} />
            <span className={[
              'text-sm',
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
