'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useAdmission } from '../AdmissionFormContext';

export function Step8Acceptance() {
  const t = useTranslations();
  const { step8Fields, setStep8Fields, patchApplication, isReadOnly } = useAdmission();
  const { termsAgreedAt } = step8Fields;
  const isAgreed = termsAgreedAt !== null;

  // StepFooter's handleSubmit calls submitApplication directly and does NOT
  // invoke the registered stepHandler. So we cannot use a stepHandler to PATCH
  // termsAgreedAt at Submit time. Instead, we persist it immediately whenever
  // the checkbox toggles — by the time Submit fires, the value is already
  // saved server-side and the submit endpoint's required-field check passes
  // (or, if the user unticked, it fails with a clear 400 that handleSubmit
  // toasts).
  const handleToggle = async (checked: boolean) => {
    const newValue = checked ? new Date().toISOString() : null;
    try {
      await patchApplication({ termsAgreedAt: newValue });
      setStep8Fields({ termsAgreedAt: newValue });
    } catch {
      toast.error(t('admissionStep8SaveError'));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-sorena-navy">{t('admissionStep8Title')}</h2>
        <p className="mt-1 text-sm text-sorena-navy/60">{t('admissionStep8Helper')}</p>
      </div>

      {/* Terms block */}
      <div className="flex flex-col gap-3 rounded-xl border border-sorena-navy/10 bg-white p-5">
        <p className="text-sm leading-relaxed text-sorena-navy/80">{t('admissionStep8TermsP1')}</p>
        <p className="text-sm leading-relaxed text-sorena-navy/80">{t('admissionStep8TermsP2')}</p>
        <p className="text-sm leading-relaxed text-sorena-navy/80">{t('admissionStep8TermsP3')}</p>
        <p className="text-sm leading-relaxed text-sorena-navy/80">{t('admissionStep8TermsP4')}</p>
      </div>

      {/* Acceptance checkbox */}
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={isAgreed}
          disabled={isReadOnly}
          onChange={(e) => handleToggle(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-sorena-navy/20 accent-sorena-navy disabled:cursor-not-allowed disabled:opacity-50"
        />
        <span className="text-sm text-sorena-navy/80">
          {t('admissionStep8AcceptanceLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </span>
      </label>
    </div>
  );
}
