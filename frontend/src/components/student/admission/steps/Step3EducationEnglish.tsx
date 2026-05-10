'use client';

import { useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useAdmission } from '../AdmissionFormContext';
import { DocumentUploader } from '../DocumentUploader';

export function Step3EducationEnglish() {
  const t = useTranslations();
  const {
    step3Fields, setStep3Fields,
    documents,
    patchApplication, registerStepHandler,
  } = useAdmission();
  const { englishTestSat, englishTestName, englishPreCourse } = step3Fields;

  const handler = useCallback(async (): Promise<boolean> => {
    if (englishTestSat === null) {
      toast.error(t('admissionStep3ValidationQuestion'));
      return false;
    }
    if (englishTestSat === true) {
      if (!englishTestName?.trim()) {
        toast.error(t('admissionStep3ValidationTestName'));
        return false;
      }
      if (!documents.some(d => d.documentType === 'ENGLISH_TEST_EVIDENCE')) {
        toast.error(t('admissionStep3ValidationEvidence'));
        return false;
      }
    }
    if (englishPreCourse === null) {
      toast.error(t('admissionStep3ValidationQuestion2'));
      return false;
    }
    try {
      const patchBody: Record<string, unknown> = { englishTestSat, englishPreCourse };
      if (englishTestSat) patchBody.englishTestName = englishTestName;
      await patchApplication(patchBody);
      return true;
    } catch {
      return false;
    }
  }, [englishTestSat, englishTestName, englishPreCourse, documents, patchApplication, t]);

  useEffect(() => {
    registerStepHandler(handler);
    return () => registerStepHandler(null);
  }, [handler, registerStepHandler]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-bold text-sorena-navy">{t('admissionStep3Title')}</h2>
        <p className="mt-1 text-sm text-sorena-navy/60">{t('admissionStep3Helper')}</p>
      </div>

      {/* Question 1 — English test sat */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep3Question1Label')}
          <span className="ml-0.5 text-red-500">*</span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStep3Fields({ englishTestSat: true })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              englishTestSat === true
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3Question1OptionYes')}
          </button>
          <button
            type="button"
            onClick={() => setStep3Fields({ englishTestSat: false })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              englishTestSat === false
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3Question1OptionNo')}
          </button>
        </div>
      </div>

      {/* Conditional — test name + evidence upload */}
      {englishTestSat === true && (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep3TestNameLabel')}
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="text"
              value={englishTestName ?? ''}
              onChange={(e) => setStep3Fields({ englishTestName: e.target.value })}
              placeholder={t('admissionStep3TestNamePlaceholder')}
              className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
            />
          </div>

          <DocumentUploader
            documentType="ENGLISH_TEST_EVIDENCE"
            label={t('admissionStep3UploadEvidenceLabel')}
            helperText={t('admissionStep3UploadEvidenceHelper')}
            single={false}
            required={true}
          />
        </>
      )}

      {/* Question 2 — English pre-course */}
      <div className="flex flex-col gap-2">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionStep3Question2Label')}
            <span className="ml-0.5 text-red-500">*</span>
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-sorena-navy/60">
            {t('admissionStep3Question2Helper')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStep3Fields({ englishPreCourse: true })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              englishPreCourse === true
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3Question1OptionYes')}
          </button>
          <button
            type="button"
            onClick={() => setStep3Fields({ englishPreCourse: false })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              englishPreCourse === false
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3Question1OptionNo')}
          </button>
        </div>
      </div>
    </div>
  );
}
