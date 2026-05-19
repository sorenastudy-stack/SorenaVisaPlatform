'use client';

import { useTranslations } from 'next-intl';
import { useVisa, VISA_TOTAL_STEPS } from './VisaFormContext';

// Lightweight step indicator. Each step is clickable so the student can jump
// to any step they have already reached (visa.currentStep tracks the
// highest step persisted to the backend; later steps stay locked until that
// catches up). Matches the styling of admission's StageProgressBar without
// dragging that component in — visa has its own progression rules.
export function VisaStepper() {
  const t = useTranslations();
  const { visa, activeStep, setActiveStep } = useVisa();

  const steps = [
    { n: 1, key: 'visaIdentitySectionTitle'          as const },
    { n: 2, key: 'visaAddressSectionTitle'           as const },
    { n: 3, key: 'visaEligibilitySectionTitle'       as const },
    { n: 4, key: 'visaCharacterSectionTitle'         as const },
    { n: 5, key: 'visaHealthSectionTitle'            as const },
    { n: 6, key: 'visaEducationHistorySectionTitle'  as const },
    { n: 7, key: 'visaEmploymentHistorySectionTitle' as const },
  ];

  // Reachable = either the active step itself or a step <= the highest the
  // student has actually saved through. Prevents skipping ahead.
  const maxReached = Math.max(activeStep, visa.currentStep ?? 1);

  return (
    <ol className="flex flex-wrap items-center gap-2">
      {steps.slice(0, VISA_TOTAL_STEPS).map(({ n, key }, idx) => {
        const reachable = n <= maxReached;
        const isActive = n === activeStep;
        return (
          <li key={n} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && setActiveStep(n)}
              className={[
                'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors',
                isActive
                  ? 'border-sorena-navy bg-sorena-navy text-white'
                  : reachable
                    ? 'border-sorena-navy/30 text-sorena-navy hover:bg-sorena-navy/5'
                    : 'border-sorena-navy/10 text-sorena-navy/40 cursor-not-allowed',
              ].join(' ')}
            >
              <span className={[
                'flex h-5 w-5 items-center justify-center rounded-full text-[10px]',
                isActive ? 'bg-white text-sorena-navy' : 'bg-sorena-navy/10',
              ].join(' ')}>{n}</span>
              <span className="hidden sm:inline">{t(key)}</span>
            </button>
            {idx < steps.length - 1 && (
              <span className="h-px w-6 bg-sorena-navy/20" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
