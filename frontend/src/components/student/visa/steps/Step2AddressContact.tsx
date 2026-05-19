'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useVisa } from '../VisaFormContext';
import { COUNTRIES } from '@/lib/data/countries';
import { SearchableSelect } from '@/components/common/SearchableSelect';

// PR-VISA2 — INZ 1200 Section 2 "Address and contact information".
// Read-only fields are pulled from contacts (countryOfResidence, fullName,
// email) — see docs/VISA_FIELD_INVENTORY.md, never re-collected here.
// PII addresses (physicalStreet, postalStreet) persist encrypted; everything
// else is plaintext.

const CONTACT_NUMBER_MAX = 16;

export function Step2AddressContact() {
  const t = useTranslations();
  const { visa, readonly, patchVisa, setActiveStep, savedAt, setSavedAt } = useVisa();

  const initial = useMemo(() => ({
    physicalStreet:           visa.physicalStreet ?? '',
    physicalSuburb:           visa.physicalSuburb ?? '',
    physicalCity:             visa.physicalCity ?? '',
    physicalState:            visa.physicalState ?? '',
    physicalPostcode:         visa.physicalPostcode ?? '',
    postalSameAsPhysical:     visa.postalSameAsPhysical,
    postalStreet:             visa.postalStreet ?? '',
    postalSuburb:             visa.postalSuburb ?? '',
    postalCity:               visa.postalCity ?? '',
    postalState:              visa.postalState ?? '',
    postalPostcode:           visa.postalPostcode ?? '',
    postalCountry:            visa.postalCountry ?? '',
    preferredContactCountryCode:   visa.preferredContactCountryCode ?? '',
    preferredContactNumber:        visa.preferredContactNumber ?? '',
    alternativeContactCountryCode: visa.alternativeContactCountryCode ?? '',
    alternativeContactNumber:      visa.alternativeContactNumber ?? '',
  }), [visa]);

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key as string]) setErrors((prev) => ({ ...prev, [key as string]: false }));
  };

  const validate = (): string[] => {
    const missing: string[] = [];
    const e: Record<string, boolean> = {};

    // Physical address — required except suburb / state / postcode.
    if (!form.physicalStreet.trim()) { e.physicalStreet = true; missing.push('physicalStreet'); }
    if (!form.physicalCity.trim())   { e.physicalCity   = true; missing.push('physicalCity'); }
    if (form.postalSameAsPhysical === null) {
      e.postalSameAsPhysical = true; missing.push('postalSameAsPhysical');
    }

    // Postal address — only when not same-as-physical. Suburb/state/postcode
    // optional; street, city, country required.
    if (form.postalSameAsPhysical === false) {
      if (!form.postalStreet.trim())  { e.postalStreet  = true; missing.push('postalStreet'); }
      if (!form.postalCity.trim())    { e.postalCity    = true; missing.push('postalCity'); }
      if (!form.postalCountry.trim()) { e.postalCountry = true; missing.push('postalCountry'); }
    }

    // Preferred — BOTH code and number required.
    if (!form.preferredContactCountryCode.trim()) {
      e.preferredContactCountryCode = true; missing.push('preferredContactCountryCode');
    }
    if (!form.preferredContactNumber.trim()) {
      e.preferredContactNumber = true; missing.push('preferredContactNumber');
    }
    if (form.preferredContactCountryCode.length > CONTACT_NUMBER_MAX) {
      e.preferredContactCountryCode = true; missing.push('preferredContactCountryCode');
    }
    if (form.preferredContactNumber.length > CONTACT_NUMBER_MAX) {
      e.preferredContactNumber = true; missing.push('preferredContactNumber');
    }
    // Alternative — optional overall, but if a number is entered the code
    // becomes mandatory too (can't have a number without its code).
    if (form.alternativeContactNumber.trim() && !form.alternativeContactCountryCode.trim()) {
      e.alternativeContactCountryCode = true; missing.push('alternativeContactCountryCode');
    }
    if (form.alternativeContactCountryCode.length > CONTACT_NUMBER_MAX) {
      e.alternativeContactCountryCode = true; missing.push('alternativeContactCountryCode');
    }
    if (form.alternativeContactNumber.length > CONTACT_NUMBER_MAX) {
      e.alternativeContactNumber = true; missing.push('alternativeContactNumber');
    }

    setErrors(e);
    return missing;
  };

  const handleSave = async () => {
    const missing = validate();
    if (missing.length > 0) {
      toast.error(t('visaAddressValidationMissing'));
      return;
    }
    setSaving(true);
    try {
      // When postalSameAsPhysical=true we explicitly clear the postal block
      // so stale ciphertext + city/country don't linger from a previous "No".
      const samePostal = form.postalSameAsPhysical === true;
      const payload: Record<string, unknown> = {
        physicalStreet:           form.physicalStreet.trim(),
        physicalSuburb:           form.physicalSuburb.trim() || null,
        physicalCity:             form.physicalCity.trim(),
        physicalState:            form.physicalState.trim() || null,
        physicalPostcode:         form.physicalPostcode.trim() || null,
        // physicalCountry is the read-only countryOfResidence — write it through
        // so the row stores a denormalised snapshot independent of contacts.
        physicalCountry:          readonly.countryOfResidence ?? null,
        postalSameAsPhysical:     form.postalSameAsPhysical,
        postalStreet:             samePostal ? null : form.postalStreet.trim(),
        postalSuburb:             samePostal ? null : (form.postalSuburb.trim() || null),
        postalCity:               samePostal ? null : form.postalCity.trim(),
        postalState:              samePostal ? null : (form.postalState.trim() || null),
        postalPostcode:           samePostal ? null : (form.postalPostcode.trim() || null),
        postalCountry:            samePostal ? null : form.postalCountry,
        preferredContactCountryCode:   form.preferredContactCountryCode.trim(),
        preferredContactNumber:        form.preferredContactNumber.trim(),
        // Alternative is optional. When the user clears the number, also
        // clear the code so a stranded code doesn't linger.
        alternativeContactCountryCode: form.alternativeContactNumber.trim()
          ? form.alternativeContactCountryCode.trim()
          : null,
        alternativeContactNumber:      form.alternativeContactNumber.trim() || null,
        // No Step 3 yet — bump to 3 so the next PR can pick up cleanly.
        currentStep:              3,
      };
      await patchVisa(payload);
      setSavedAt(new Date().toISOString());
      toast.success(t('visaAddressSaveSuccess'));
    } catch {
      toast.error(t('visaAddressSaveError'));
    } finally {
      setSaving(false);
    }
  };

  // ── Building blocks (kept local to mirror Step 1's shape) ───────────────

  const Asterisk = () => <span className="ml-0.5 text-red-500">*</span>;

  const YesNo = ({
    value, onChange, ariaInvalid,
  }: { value: boolean | null; onChange: (v: boolean) => void; ariaInvalid?: boolean }) => (
    <div className={['flex gap-2', ariaInvalid ? 'rounded-lg ring-1 ring-red-400 p-1' : ''].join(' ')}>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={[
          'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
          value === true
            ? 'border-sorena-navy bg-sorena-navy text-white'
            : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
        ].join(' ')}
      >
        {t('visaCommonYes')}
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={[
          'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
          value === false
            ? 'border-sorena-navy bg-sorena-navy text-white'
            : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
        ].join(' ')}
      >
        {t('visaCommonNo')}
      </button>
    </div>
  );

  const ReadonlyField = ({ label, value }: { label: string; value: string }) => (
    <div>
      <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
        {label}
      </label>
      <div className="rounded-lg border border-sorena-navy/10 bg-gray-50 px-3 py-2.5 text-sm text-sorena-navy/80">
        {value || <span className="italic text-sorena-navy/40">{t('visaCommonNotProvided')}</span>}
      </div>
    </div>
  );

  // INZ green/info "ALERT" box — distinct from the red WARNING used in Step 1.
  const InfoAlert = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
      <p className="mb-1 font-bold uppercase tracking-wide">{t('visaCommonAlertLabel')}</p>
      {children}
    </div>
  );

  const inputClass = (hasError: boolean) =>
    [
      'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-sorena-navy">{t('visaAddressSectionTitle')}</h2>
      <p className="text-sm text-sorena-navy/70">{t('visaAddressIntro')}</p>

      {/* Saved confirmation banner */}
      {savedAt && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('visaAddressSavedBanner')}
        </div>
      )}

      {/* ── Subsection: Address details ─────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaAddressSubsectionAddress')}</h3>
        <p className="mt-2 text-sm text-sorena-navy/70">{t('visaAddressHelperLocation')}</p>
        <p className="mt-1 text-sm text-sorena-navy/70">{t('visaAddressHelperLiving')}</p>
      </div>

      {/* 1. Current country or territory — RO */}
      <ReadonlyField
        label={t('visaAddressCurrentCountryLabel')}
        value={readonly.countryOfResidence ?? ''}
      />

      {/* 2. Street address — encrypted */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaAddressStreetLabel')}<Asterisk />
        </label>
        <input
          type="text"
          value={form.physicalStreet}
          onChange={(e) => update('physicalStreet', e.target.value)}
          placeholder={t('visaAddressStreetPlaceholder')}
          className={inputClass(!!errors.physicalStreet)}
        />
      </div>

      {/* 3. Suburb / district (optional) */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaAddressSuburbLabel')}
        </label>
        <input
          type="text"
          value={form.physicalSuburb}
          onChange={(e) => update('physicalSuburb', e.target.value)}
          className={inputClass(false)}
        />
      </div>

      {/* 4. Town or city */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaAddressCityLabel')}<Asterisk />
        </label>
        <input
          type="text"
          value={form.physicalCity}
          onChange={(e) => update('physicalCity', e.target.value)}
          className={inputClass(!!errors.physicalCity)}
        />
      </div>

      {/* 5. State / province / region (optional) */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaAddressStateLabel')}
        </label>
        <input
          type="text"
          value={form.physicalState}
          onChange={(e) => update('physicalState', e.target.value)}
          className={inputClass(false)}
        />
      </div>

      {/* 6. Postcode (optional) */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaAddressPostcodeLabel')}
        </label>
        <input
          type="text"
          value={form.physicalPostcode}
          onChange={(e) => update('physicalPostcode', e.target.value)}
          className={inputClass(false)}
        />
      </div>

      {/* 7. Postal-same-as-physical */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaAddressPostalSameLabel')}<Asterisk />
        </p>
        <p className="text-sm text-sorena-navy/60">{t('visaAddressPostalSameHelper')}</p>
        <YesNo
          value={form.postalSameAsPhysical}
          onChange={(v) => update('postalSameAsPhysical', v)}
          ariaInvalid={errors.postalSameAsPhysical}
        />
      </div>

      {/* Postal block — only when same-as-physical = No */}
      {form.postalSameAsPhysical === false && (
        <div className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4">
          <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
            {t('visaAddressPostalBlockHeading')}
          </h4>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaAddressStreetLabel')}<Asterisk />
            </label>
            <input
              type="text"
              value={form.postalStreet}
              onChange={(e) => update('postalStreet', e.target.value)}
              placeholder={t('visaAddressStreetPlaceholder')}
              className={inputClass(!!errors.postalStreet)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaAddressSuburbLabel')}
            </label>
            <input
              type="text"
              value={form.postalSuburb}
              onChange={(e) => update('postalSuburb', e.target.value)}
              className={inputClass(false)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaAddressCityLabel')}<Asterisk />
            </label>
            <input
              type="text"
              value={form.postalCity}
              onChange={(e) => update('postalCity', e.target.value)}
              className={inputClass(!!errors.postalCity)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaAddressStateLabel')}
            </label>
            <input
              type="text"
              value={form.postalState}
              onChange={(e) => update('postalState', e.target.value)}
              className={inputClass(false)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaAddressPostcodeLabel')}
            </label>
            <input
              type="text"
              value={form.postalPostcode}
              onChange={(e) => update('postalPostcode', e.target.value)}
              className={inputClass(false)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaAddressPostalCountryLabel')}<Asterisk />
            </label>
            <SearchableSelect
              options={COUNTRIES}
              value={form.postalCountry}
              onChange={(v) => update('postalCountry', v)}
              placeholder={t('visaCommonCountryPlaceholder')}
              hasError={errors.postalCountry}
            />
          </div>
        </div>
      )}

      {/* ── Subsection: Contact details ─────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaAddressSubsectionContact')}</h3>
      </div>

      <InfoAlert>{t('visaAddressContactAlertEmail')}</InfoAlert>
      <p className="text-sm text-sorena-navy/70">{t('visaAddressGuardianHelper')}</p>

      {/* 8. Applicant's email — RO */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaAddressEmailLabel')}
        </label>
        <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaAddressEmailHelper')}</p>
        <div className="rounded-lg border border-sorena-navy/10 bg-gray-50 px-3 py-2.5 text-sm text-sorena-navy/80">
          {readonly.email || <span className="italic text-sorena-navy/40">{t('visaCommonNotProvided')}</span>}
        </div>
      </div>

      <InfoAlert>{t('visaAddressContactAlertEmailCheck')}</InfoAlert>

      {/* 9. Preferred contact number — country code + number */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaAddressPreferredContactLabel')}<Asterisk />
        </label>
        <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaAddressPhoneHelperSplit')}</p>
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <input
            type="text"
            value={form.preferredContactCountryCode}
            onChange={(e) => update('preferredContactCountryCode', e.target.value)}
            maxLength={CONTACT_NUMBER_MAX}
            placeholder={t('visaAddressPhoneCodePlaceholder')}
            aria-label={t('visaAddressPhoneCodeLabel')}
            className={inputClass(!!errors.preferredContactCountryCode)}
          />
          <input
            type="text"
            value={form.preferredContactNumber}
            onChange={(e) => update('preferredContactNumber', e.target.value)}
            maxLength={CONTACT_NUMBER_MAX}
            placeholder={t('visaAddressPhoneNumberPlaceholder')}
            aria-label={t('visaAddressPhoneNumberLabel')}
            className={inputClass(!!errors.preferredContactNumber)}
          />
        </div>
      </div>

      {/* 10. Alternative contact number — country code + number (optional) */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaAddressAlternativeContactLabel')}
        </label>
        <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaAddressPhoneHelperSplit')}</p>
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <input
            type="text"
            value={form.alternativeContactCountryCode}
            onChange={(e) => update('alternativeContactCountryCode', e.target.value)}
            maxLength={CONTACT_NUMBER_MAX}
            placeholder={t('visaAddressPhoneCodePlaceholder')}
            aria-label={t('visaAddressPhoneCodeLabel')}
            className={inputClass(!!errors.alternativeContactCountryCode)}
          />
          <input
            type="text"
            value={form.alternativeContactNumber}
            onChange={(e) => update('alternativeContactNumber', e.target.value)}
            maxLength={CONTACT_NUMBER_MAX}
            placeholder={t('visaAddressPhoneNumberPlaceholder')}
            aria-label={t('visaAddressPhoneNumberLabel')}
            className={inputClass(!!errors.alternativeContactNumber)}
          />
        </div>
      </div>

      {/* Back + Save row */}
      <div className="flex items-center justify-between border-t border-sorena-navy/10 pt-4">
        <button
          type="button"
          onClick={() => setActiveStep(1)}
          className="rounded-lg border border-sorena-navy/20 px-4 py-2 text-sm text-sorena-navy transition-colors hover:bg-sorena-navy/5"
        >
          {t('visaCommonBack')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-sorena-navy px-6 py-2 text-base font-semibold text-white transition-colors hover:bg-sorena-navy/90 disabled:opacity-40"
        >
          {saving ? t('visaCommonSaving') : t('visaAddressSaveButton')}
        </button>
      </div>
    </div>
  );
}
