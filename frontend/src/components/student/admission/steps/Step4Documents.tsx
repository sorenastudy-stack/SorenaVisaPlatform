'use client';

import { useTranslations } from 'next-intl';
import { DocumentUploader } from '../DocumentUploader';
import { EducationHistoryEditor } from '../EducationHistoryEditor';

export function Step4Documents() {
  const t = useTranslations();
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
