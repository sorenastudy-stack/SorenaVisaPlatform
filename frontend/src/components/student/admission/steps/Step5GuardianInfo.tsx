'use client';

import { useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useAdmission } from '../AdmissionFormContext';
import { CountrySelect } from '@/components/common/CountrySelect';

const RELATIONSHIP_OPTIONS = [
  { value: 'PARENT',     key: 'admissionStep5RelationshipOptionParent'     },
  { value: 'STEPPARENT', key: 'admissionStep5RelationshipOptionStepparent' },
  { value: 'GUARDIAN',   key: 'admissionStep5RelationshipOptionGuardian'   },
  { value: 'OTHER',      key: 'admissionStep5RelationshipOptionOther'      },
] as const;

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export function Step5GuardianInfo() {
  const t = useTranslations();
  const { step5Fields, setStep5Fields, patchApplication, registerStepHandler } = useAdmission();
  const {
    guardianRelationship, guardianFirstName, guardianLastName,
    guardianEmail, guardianMobile, guardianHomePhone,
    guardianAddressSameAs,
    guardianStreet, guardianSuburb, guardianCity,
    guardianState, guardianCountry, guardianPostcode,
  } = step5Fields;

  const handler = useCallback(async (): Promise<boolean> => {
    if (!guardianRelationship) {
      toast.error(t('admissionStep5ValidationRelationship'));
      return false;
    }
    if (!guardianFirstName?.trim()) {
      toast.error(t('admissionStep5ValidationFirstName'));
      return false;
    }
    if (!guardianLastName?.trim()) {
      toast.error(t('admissionStep5ValidationLastName'));
      return false;
    }
    if (!guardianEmail?.trim()) {
      toast.error(t('admissionStep5ValidationEmail'));
      return false;
    }
    if (!EMAIL_RE.test(guardianEmail.trim())) {
      toast.error(t('admissionStep5ValidationEmailFormat'));
      return false;
    }
    if (!guardianMobile?.trim()) {
      toast.error(t('admissionStep5ValidationMobile'));
      return false;
    }
    if (guardianAddressSameAs === null) {
      toast.error(t('admissionStep5ValidationAddressSameAs'));
      return false;
    }
    if (guardianAddressSameAs === false) {
      if (!guardianStreet?.trim()) {
        toast.error(t('admissionStep5ValidationStreet'));
        return false;
      }
      if (!guardianSuburb?.trim()) {
        toast.error(t('admissionStep5ValidationSuburb'));
        return false;
      }
      if (!guardianCity?.trim()) {
        toast.error(t('admissionStep5ValidationCity'));
        return false;
      }
      if (!guardianCountry?.trim()) {
        toast.error(t('admissionStep5ValidationCountry'));
        return false;
      }
      if (!guardianPostcode?.trim()) {
        toast.error(t('admissionStep5ValidationPostcode'));
        return false;
      }
    }
    try {
      const patchBody: Record<string, unknown> = {
        guardianRelationship,
        guardianFirstName: guardianFirstName.trim(),
        guardianLastName: guardianLastName.trim(),
        guardianEmail: guardianEmail.trim(),
        guardianMobile: guardianMobile.trim(),
        guardianAddressSameAs,
      };
      if (guardianHomePhone?.trim()) {
        patchBody.guardianHomePhone = guardianHomePhone.trim();
      }
      if (guardianAddressSameAs === true) {
        // "Same as student's address" — clear any previously saved address rows.
        patchBody.guardianStreet = null;
        patchBody.guardianSuburb = null;
        patchBody.guardianCity = null;
        patchBody.guardianState = null;
        patchBody.guardianCountry = null;
        patchBody.guardianPostcode = null;
      } else {
        patchBody.guardianStreet = guardianStreet!.trim();
        patchBody.guardianSuburb = guardianSuburb!.trim();
        patchBody.guardianCity = guardianCity!.trim();
        patchBody.guardianCountry = guardianCountry!.trim();
        patchBody.guardianPostcode = guardianPostcode!.trim();
        // State is optional.
        if (guardianState?.trim()) {
          patchBody.guardianState = guardianState.trim();
        }
      }
      await patchApplication(patchBody);
      return true;
    } catch {
      return false;
    }
  }, [
    guardianRelationship, guardianFirstName, guardianLastName,
    guardianEmail, guardianMobile, guardianHomePhone,
    guardianAddressSameAs,
    guardianStreet, guardianSuburb, guardianCity,
    guardianState, guardianCountry, guardianPostcode,
    patchApplication, t,
  ]);

  useEffect(() => {
    registerStepHandler(handler);
    return () => registerStepHandler(null);
  }, [handler, registerStepHandler]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-sorena-navy">{t('admissionStep5Title')}</h2>
        <p className="mt-1 text-sm text-sorena-navy/60">{t('admissionStep5Helper')}</p>
      </div>

      {/* Relationship */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep5RelationshipLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </label>
        <select
          value={guardianRelationship ?? ''}
          onChange={(e) => setStep5Fields({ guardianRelationship: e.target.value || null })}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
        >
          <option value="" disabled>{t('admissionStep5RelationshipPlaceholder')}</option>
          {RELATIONSHIP_OPTIONS.map(({ value, key }) => (
            <option key={value} value={value}>{t(key)}</option>
          ))}
        </select>
      </div>

      {/* First name */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep5FirstNameLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </label>
        <input
          type="text"
          value={guardianFirstName ?? ''}
          onChange={(e) => setStep5Fields({ guardianFirstName: e.target.value })}
          placeholder={t('admissionStep5FirstNamePlaceholder')}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
        />
      </div>

      {/* Last name */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep5LastNameLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </label>
        <input
          type="text"
          value={guardianLastName ?? ''}
          onChange={(e) => setStep5Fields({ guardianLastName: e.target.value })}
          placeholder={t('admissionStep5LastNamePlaceholder')}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
        />
      </div>

      {/* Email */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep5EmailLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </label>
        <input
          type="email"
          value={guardianEmail ?? ''}
          onChange={(e) => setStep5Fields({ guardianEmail: e.target.value })}
          placeholder={t('admissionStep5EmailPlaceholder')}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
        />
      </div>

      {/* Mobile */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep5MobileLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </label>
        <input
          type="text"
          value={guardianMobile ?? ''}
          onChange={(e) => setStep5Fields({ guardianMobile: e.target.value })}
          placeholder={t('admissionStep5MobilePlaceholder')}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
        />
      </div>

      {/* Home phone (optional) */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep5HomePhoneLabel')}
        </label>
        <input
          type="text"
          value={guardianHomePhone ?? ''}
          onChange={(e) => setStep5Fields({ guardianHomePhone: e.target.value })}
          placeholder={t('admissionStep5HomePhonePlaceholder')}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
        />
      </div>

      {/* Address same as student's? */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep5AddressSameAsLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStep5Fields({ guardianAddressSameAs: true })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              guardianAddressSameAs === true
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3Question1OptionYes')}
          </button>
          <button
            type="button"
            onClick={() => setStep5Fields({ guardianAddressSameAs: false })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              guardianAddressSameAs === false
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3Question1OptionNo')}
          </button>
        </div>
      </div>

      {/* Address subsection (only when different from student's) */}
      {guardianAddressSameAs === false && (
        <>
          <div className="mt-4 border-t border-sorena-navy/10 pt-6">
            <h3 className="text-xl font-bold text-sorena-navy">{t('admissionStep5AddressSectionTitle')}</h3>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep5StreetLabel')}
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="text"
              value={guardianStreet ?? ''}
              onChange={(e) => setStep5Fields({ guardianStreet: e.target.value })}
              placeholder={t('admissionStep5StreetPlaceholder')}
              className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep5SuburbLabel')}
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="text"
              value={guardianSuburb ?? ''}
              onChange={(e) => setStep5Fields({ guardianSuburb: e.target.value })}
              placeholder={t('admissionStep5SuburbPlaceholder')}
              className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep5CityLabel')}
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="text"
              value={guardianCity ?? ''}
              onChange={(e) => setStep5Fields({ guardianCity: e.target.value })}
              placeholder={t('admissionStep5CityPlaceholder')}
              className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep5StateLabel')}
            </label>
            <input
              type="text"
              value={guardianState ?? ''}
              onChange={(e) => setStep5Fields({ guardianState: e.target.value })}
              placeholder={t('admissionStep5StatePlaceholder')}
              className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep5CountryLabel')}
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            <CountrySelect
              value={guardianCountry || null}
              onChange={(code) => setStep5Fields({ guardianCountry: code ?? '' })}
              placeholder={t('admissionStep5CountryPlaceholder')}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep5PostcodeLabel')}
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="text"
              value={guardianPostcode ?? ''}
              onChange={(e) => setStep5Fields({ guardianPostcode: e.target.value })}
              placeholder={t('admissionStep5PostcodePlaceholder')}
              className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
            />
          </div>
        </>
      )}
    </div>
  );
}
