'use client';

import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { useAdmission } from './AdmissionFormContext';

const STEP_LABELS: Record<number, string> = {
  1: 'admissionStep1Title',
  2: 'admissionStep2Title',
  3: 'admissionStep3Title',
  4: 'admissionStep4Title',
  5: 'admissionStep5Title',
  6: 'admissionStep6Title',
  7: 'admissionStep7Title',
  8: 'admissionStep8Title',
};

// Step 7 (Agent information) is hidden for non-agent users
const STUDENT_STEPS = [1, 2, 3, 4, 5, 6, 8];
const AGENT_STEPS   = [1, 2, 3, 4, 5, 6, 7, 8];

export function StepNav({ isAgent }: { isAgent: boolean }) {
  const t = useTranslations();
  const { currentStep, setCurrentStep, isReadOnly, application } = useAdmission();
  const visibleSteps = isAgent ? AGENT_STEPS : STUDENT_STEPS;
  const savedStep = application?.currentStep ?? 1;

  return (
    <nav className="flex flex-col gap-1">
      {visibleSteps.map((n, idx) => {
        const isActive   = n === currentStep;
        const isDone     = savedStep > n || isReadOnly;
        const displayNum = idx + 1;

        return (
          <button
            key={n}
            onClick={() => !isReadOnly && isDone && setCurrentStep(n)}
            className={[
              'flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
              isActive
                ? 'bg-sorena-navy text-white font-medium'
                : isDone
                  ? 'cursor-pointer text-sorena-navy/70 hover:bg-sorena-navy/5'
                  : 'cursor-default text-sorena-navy/35',
            ].join(' ')}
          >
            <span className={[
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
              isActive
                ? 'border-white bg-white text-sorena-navy'
                : isDone
                  ? 'border-sorena-gold bg-sorena-gold text-white'
                  : 'border-sorena-navy/20 text-sorena-navy/35',
            ].join(' ')}>
              {isDone && !isActive ? <Check size={12} /> : displayNum}
            </span>
            <span className="truncate">{t(STEP_LABELS[n])}</span>
          </button>
        );
      })}
    </nav>
  );
}
