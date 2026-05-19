'use client';

import { useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useAdmission } from '../AdmissionFormContext';
import { DocumentUploader } from '../DocumentUploader';
import {
  EducationHistoryEditor,
  findProgressionViolation,
} from '../EducationHistoryEditor';

export function Step4Documents() {
  const t = useTranslations();
  const { educationEntries, registerStepHandler } = useAdmission();

  // Hard-block Next while a qualification-progression violation exists.
  // The warning banner already renders in EducationHistoryEditor; here we
  // surface a toast and scroll it into view so the user can't miss it.
  const handler = useCallback(async (): Promise<boolean> => {
    if (findProgressionViolation(educationEntries)) {
      toast.error(t('admissionStep4ValidationProgression'));
      if (typeof document !== 'undefined') {
        document
          .getElementById('education-progression-warning')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return false;
    }
    return true;
  }, [educationEntries, t]);

  useEffect(() => {
    registerStepHandler(handler);
    return () => registerStepHandler(null);
  }, [handler, registerStepHandler]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-sorena-navy">{t('admissionStep4Title')}</h2>
        <p className="mt-1 text-sm text-sorena-navy/60">{t('admissionStep4Helper')}</p>
      </div>

      {/* Repeating education history with per-row notarized uploads. */}
      <EducationHistoryEditor />

      {/* App-level supporting documents (anything not tied to one entry). */}
      <div className="mt-4 border-t border-sorena-navy/10 pt-6">
        <DocumentUploader
          documentType="SUPPORTING_DOCUMENT"
          label={t('admissionStep4SupportingLabel')}
          helperText={t('admissionStep4SupportingHelper')}
          single={false}
          required={false}
        />
      </div>
    </div>
  );
}
