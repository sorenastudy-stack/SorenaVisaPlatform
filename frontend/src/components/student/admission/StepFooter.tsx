'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAdmission } from './AdmissionFormContext';
import { ApiError } from '@/lib/api';

const STUDENT_STEPS = [1, 2, 3, 4, 5, 6, 8];
const AGENT_STEPS   = [1, 2, 3, 4, 5, 6, 7, 8];

export function StepFooter({ isAgent }: { isAgent: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const { currentStep, setCurrentStep, programmeChoices, patchApplication, submitApplication } = useAdmission();
  const steps  = isAgent ? AGENT_STEPS : STUDENT_STEPS;
  const idx    = steps.indexOf(currentStep);
  const isFirst = idx === 0;
  const isLast  = idx === steps.length - 1;

  // correction 3: persist current step + toast + redirect to dashboard
  const handleSave = async () => {
    try {
      await patchApplication({ currentStep });
      toast.success(t('admissionSavedToast'));
      router.push('/student');
    } catch {
      toast.error('Could not save progress. Please try again.');
    }
  };

  const handleNext = () => {
    if (currentStep === 1 && programmeChoices.length === 0) {
      toast.error(t('admissionStep1NoChoices'));
      return;
    }
    setCurrentStep(steps[idx + 1]);
  };

  // correction 4: submit endpoint + refresh state so isReadOnly flips
  const handleSubmit = async () => {
    try {
      await submitApplication();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.statusCode === 400) {
        toast.error(err.message);
      } else {
        toast.error('Could not submit. Please try again.');
      }
    }
  };

  return (
    <div className="flex items-center justify-between border-t border-sorena-navy/10 pt-4">
      <button
        onClick={() => !isFirst && setCurrentStep(steps[idx - 1])}
        disabled={isFirst}
        className="rounded-lg border border-sorena-navy/20 px-4 py-2 text-sm text-sorena-navy transition-colors hover:bg-sorena-navy/5 disabled:opacity-30"
      >
        {t('admissionBack')}
      </button>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="text-sm text-sorena-navy/50 transition-colors hover:text-sorena-navy"
        >
          {t('admissionSaveForLater')}
        </button>

        {isLast ? (
          <button
            onClick={handleSubmit}
            className="rounded-lg bg-sorena-gold px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-sorena-gold/90"
          >
            {t('admissionSubmit')}
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="rounded-lg bg-sorena-navy px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-sorena-navy/90"
          >
            {t('admissionNext')}
          </button>
        )}
      </div>
    </div>
  );
}
