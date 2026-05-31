'use client';

import { useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useAdmission }     from '../AdmissionFormContext';
import { DocumentUploader } from '../DocumentUploader';
import { CountrySelect }    from '@/components/common/CountrySelect';
import { ETHNICITIES }      from '@/lib/data/ethnicities';

export function Step2AdditionalInfo() {
  const t = useTranslations();
  const {
    step2Fields, setStep2Fields,
    documents,
    patchApplication,
    registerStepHandler,
  } = useAdmission();

  const {
    dateOfBirth, maritalStatus, hasChildren,
    phone, phoneType, countryOfBirth,
    citizenship, ethnicity, passportNumber,
    respondedYesToAdditionalQuestion,
  } = step2Fields;

  const handler = useCallback(async (): Promise<boolean> => {
    if (!dateOfBirth || !maritalStatus || !phone || !phoneType || !countryOfBirth
        || !citizenship || !ethnicity || !passportNumber) {
      toast.error(t('admissionStep2ValidationFields'));
      return false;
    }
    if (hasChildren === null) {
      toast.error(t('admissionStep2ValidationFields'));
      return false;
    }
    // DOB sanity: parseable, not in the future, plausible age 10–100.
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime()) || dob > new Date()) {
      toast.error(t('admissionStep2ValidationDobInvalid'));
      return false;
    }
    const ageYears = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (ageYears < 10 || ageYears > 100) {
      toast.error(t('admissionStep2ValidationDobRange'));
      return false;
    }
    if (!documents.some(d => d.documentType === 'PASSPORT')) {
      toast.error(t('admissionStep2ValidationPassport'));
      return false;
    }
    if (respondedYesToAdditionalQuestion === null) {
      toast.error(t('admissionStep2ValidationQuestion'));
      return false;
    }
    if (respondedYesToAdditionalQuestion === true && !documents.some(d => d.documentType === 'VISA_REFUSAL_LETTER')) {
      toast.error(t('admissionStep2ValidationSlot3'));
      return false;
    }
    try {
      await patchApplication({
        dateOfBirth, maritalStatus, hasChildren,
        phone, phoneType, countryOfBirth, citizenship, ethnicity, passportNumber,
        visaRefused: respondedYesToAdditionalQuestion,
      });
      return true;
    } catch {
      toast.error(t('admissionStep2SaveError'));
      return false;
    }
  }, [dateOfBirth, maritalStatus, hasChildren,
      phone, phoneType, countryOfBirth, citizenship, ethnicity, passportNumber,
      respondedYesToAdditionalQuestion, documents, patchApplication, t]);

  useEffect(() => {
    registerStepHandler(handler);
    return () => registerStepHandler(null);
  }, [handler, registerStepHandler]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-bold text-sorena-navy">{t('admissionStep2Title')}</h2>
        <p className="mt-1 text-sm text-sorena-navy/60">{t('admissionStep2Helper')}</p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4">
        {/* Date of birth */}
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionStep2DobLabel')}
          </label>
          <input
            type="date"
            value={dateOfBirth}
            onChange={(e) => setStep2Fields({ dateOfBirth: e.target.value })}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>

        {/* Field A — phone */}
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionStep2FieldALabel')}
          </label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setStep2Fields({ phone: e.target.value })}
            placeholder={t('admissionStep2FieldAPlaceholder')}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>

        {/* Field B — phoneType */}
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionStep2FieldBLabel')}
          </label>
          <select
            value={phoneType}
            onChange={(e) => setStep2Fields({ phoneType: e.target.value })}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
          >
            <option value="" disabled />
            <option value="Mobile">{t('admissionStep2OptionMobile')}</option>
            <option value="Home">{t('admissionStep2OptionHome')}</option>
            <option value="Work">{t('admissionStep2OptionWork')}</option>
          </select>
        </div>

        {/* Field C — countryOfBirth */}
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionStep2FieldCLabel')}
          </label>
          <CountrySelect
            value={countryOfBirth || null}
            onChange={(code) => setStep2Fields({ countryOfBirth: code ?? '' })}
            placeholder={t('admissionStep2FieldCPlaceholder')}
          />
        </div>

        {/* Field D — citizenship */}
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionStep2FieldDLabel')}
          </label>
          <CountrySelect
            value={citizenship || null}
            onChange={(code) => setStep2Fields({ citizenship: code ?? '' })}
            placeholder={t('admissionStep2FieldDPlaceholder')}
          />
        </div>

        {/* Field E — ethnicity */}
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionStep2FieldELabel')}
          </label>
          <select
            value={ethnicity}
            onChange={(e) => setStep2Fields({ ethnicity: e.target.value })}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
          >
            <option value="" disabled>{t('admissionStep2FieldEPlaceholder')}</option>
            {ETHNICITIES.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        {/* Marital status */}
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionStep2MaritalStatusLabel')}
          </label>
          <select
            value={maritalStatus}
            onChange={(e) => setStep2Fields({ maritalStatus: e.target.value })}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
          >
            <option value="" disabled>{t('admissionStep2MaritalStatusPlaceholder')}</option>
            <option value="SINGLE">{t('admissionStep2MaritalOptionSingle')}</option>
            <option value="MARRIED">{t('admissionStep2MaritalOptionMarried')}</option>
            <option value="DE_FACTO">{t('admissionStep2MaritalOptionDeFacto')}</option>
            <option value="WIDOWED">{t('admissionStep2MaritalOptionWidowed')}</option>
            <option value="DIVORCED">{t('admissionStep2MaritalOptionDivorced')}</option>
            <option value="SEPARATED">{t('admissionStep2MaritalOptionSeparated')}</option>
          </select>
        </div>

        {/* Has children — Y/N pills */}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionStep2HasChildrenLabel')}
            <span className="ml-0.5 text-red-500">*</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep2Fields({ hasChildren: true })}
              className={[
                'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
                hasChildren === true
                  ? 'border-sorena-navy bg-sorena-navy text-white'
                  : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
              ].join(' ')}
            >
              {t('admissionStep2Question1OptionYes')}
            </button>
            <button
              type="button"
              onClick={() => setStep2Fields({ hasChildren: false })}
              className={[
                'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
                hasChildren === false
                  ? 'border-sorena-navy bg-sorena-navy text-white'
                  : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
              ].join(' ')}
            >
              {t('admissionStep2Question1OptionNo')}
            </button>
          </div>
        </div>

        {/* Field F — passportNumber */}
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionStep2FieldFLabel')}
          </label>
          <input
            type="text"
            value={passportNumber}
            onChange={(e) => setStep2Fields({ passportNumber: e.target.value })}
            placeholder={t('admissionStep2FieldFPlaceholder')}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>
      </div>

      <DocumentUploader
        documentType="PASSPORT"
        label={t('admissionStep2UploadSlot1Label')}
        helperText={t('admissionStep2UploadSlot1Helper')}
        single={true}
        required={true}
      />

      <DocumentUploader
        documentType="NZ_VISA_HISTORY"
        label={t('admissionStep2UploadSlot2Label')}
        helperText={t('admissionStep2UploadSlot2Helper')}
        single={false}
        required={false}
      />

      {/* Question 1 — boolean */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep2Question1Label')}
          <span className="ml-0.5 text-red-500">*</span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStep2Fields({ respondedYesToAdditionalQuestion: true })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              respondedYesToAdditionalQuestion === true
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep2Question1OptionYes')}
          </button>
          <button
            type="button"
            onClick={() => setStep2Fields({ respondedYesToAdditionalQuestion: false })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              respondedYesToAdditionalQuestion === false
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep2Question1OptionNo')}
          </button>
        </div>
      </div>

      {respondedYesToAdditionalQuestion === true && (
        <DocumentUploader
          documentType="VISA_REFUSAL_LETTER"
          label={t('admissionStep2UploadSlot3Label')}
          helperText={t('admissionStep2UploadSlot3Helper')}
          single={false}
          required={true}
        />
      )}
    </div>
  );
}
