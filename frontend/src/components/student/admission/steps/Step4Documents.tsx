'use client';

import { useTranslations } from 'next-intl';
import { DocumentUploader } from '../DocumentUploader';

export function Step4Documents() {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-sorena-navy">{t('admissionStep4Title')}</h2>
        <p className="mt-1 text-sm text-sorena-navy/60">{t('admissionStep4Helper')}</p>
      </div>
      <DocumentUploader
        documentType="SUPPORTING_DOCUMENT"
        label="Supporting documents"
        helperText="You can upload more than one file."
        single={false}
        required={false}
      />
    </div>
  );
}
