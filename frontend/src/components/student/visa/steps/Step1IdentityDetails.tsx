'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useVisa } from '../VisaFormContext';
import { COUNTRIES } from '@/lib/data/countries';
import { SearchableSelect } from '@/components/common/SearchableSelect';

// PR-VISA1 — INZ 1200 Section 1 "Identity Details".
// Read-only fields are pulled from the readonly snapshot (contacts + admission).
// New fields persist through PATCH /students/me/visa/application.

const GENDER_OPTIONS = [
  { value: 'MALE',           key: 'visaIdentityGenderMale'           },
  { value: 'FEMALE',         key: 'visaIdentityGenderFemale'         },
  { value: 'GENDER_DIVERSE', key: 'visaIdentityGenderDiverse'        },
] as const;

const MIDDLE_NAMES_MAX = 30;

// Naive split — `contacts.fullName` is one column. Treat the last whitespace
// token as the surname and everything before as the first name. If there is
// no whitespace, the full string is the surname (matches INZ "mononym" case
// when an explicit surname is unknown to us).
function splitName(fullName: string): { firstName: string; surname: string } {
  const trimmed = (fullName ?? '').trim();
  if (!trimmed) return { firstName: '', surname: '' };
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) return { firstName: '', surname: trimmed };
  return {
    firstName: trimmed.slice(0, lastSpace).trim(),
    surname:   trimmed.slice(lastSpace + 1).trim(),
  };
}

// Format an ISO date (or null) for an HTML date input (YYYY-MM-DD).
function isoToDateInput(iso: string | null): string {
  return (iso ?? '').slice(0, 10);
}

// Convert a `<input type="date">` value to an ISO string the API accepts.
// Returns null for the empty string so the PATCH clears the column.
function dateInputToIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function Step1IdentityDetails() {
  const t = useTranslations();
  const { visa, readonly, patchVisa, savedAt, setSavedAt } = useVisa();

  // Local-state buffer. The form is "save and continue" — we don't PATCH on
  // every keystroke. Submit happens on the single button click at the bottom.
  const initial = useMemo(() => ({
    hasMononym:             visa.hasMononym,
    middleNames:            visa.middleNames ?? '',
    hasUsedOtherNames:      visa.hasUsedOtherNames,
    otherNames:             visa.otherNames ?? '',
    countryWhenSubmitting:  visa.countryWhenSubmitting ?? '',
    prevAppliedNzVisa:      visa.prevAppliedNzVisa,
    prevRequestedNzeta:     visa.prevRequestedNzeta,
    everTravelledNz:        visa.everTravelledNz,
    totalNzTime24Plus:      visa.totalNzTime24Plus,
    passportIssueDate:      isoToDateInput(visa.passportIssueDate),
    passportExpiryDate:     isoToDateInput(visa.passportExpiryDate),
    passportCountryOfIssue: visa.passportCountryOfIssue ?? '',
    passportGender:         visa.passportGender ?? '',
    stateOfBirth:           visa.stateOfBirth ?? '',
    cityOfBirth:            visa.cityOfBirth ?? '',
    hasNationalId:          visa.hasNationalId,
    nationalId:             visa.nationalId ?? '',
    nationalIdCountry:      visa.nationalIdCountry ?? '',
  }), [visa]);

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key as string]) setErrors((prev) => ({ ...prev, [key as string]: false }));
  };

  const { firstName, surname } = splitName(readonly.fullName);

  // Validation — every field mandatory except middle names and the conditional
  // fields when their toggle is No.
  const validate = (): string[] => {
    const missing: string[] = [];
    const e: Record<string, boolean> = {};

    if (form.hasMononym === null) { e.hasMononym = true; missing.push('hasMononym'); }
    if (form.hasUsedOtherNames === null) { e.hasUsedOtherNames = true; missing.push('hasUsedOtherNames'); }
    if (form.hasUsedOtherNames === true && !form.otherNames.trim()) {
      e.otherNames = true; missing.push('otherNames');
    }
    if (!form.countryWhenSubmitting.trim()) { e.countryWhenSubmitting = true; missing.push('countryWhenSubmitting'); }
    if (form.prevAppliedNzVisa === null) { e.prevAppliedNzVisa = true; missing.push('prevAppliedNzVisa'); }
    if (form.prevRequestedNzeta === null) { e.prevRequestedNzeta = true; missing.push('prevRequestedNzeta'); }
    if (form.everTravelledNz === null) { e.everTravelledNz = true; missing.push('everTravelledNz'); }
    if (form.totalNzTime24Plus === null) { e.totalNzTime24Plus = true; missing.push('totalNzTime24Plus'); }
    if (!form.passportCountryOfIssue.trim()) { e.passportCountryOfIssue = true; missing.push('passportCountryOfIssue'); }
    if (!form.passportIssueDate) { e.passportIssueDate = true; missing.push('passportIssueDate'); }
    if (!form.passportExpiryDate) { e.passportExpiryDate = true; missing.push('passportExpiryDate'); }
    if (!form.passportGender) { e.passportGender = true; missing.push('passportGender'); }
    if (!form.stateOfBirth.trim()) { e.stateOfBirth = true; missing.push('stateOfBirth'); }
    if (!form.cityOfBirth.trim()) { e.cityOfBirth = true; missing.push('cityOfBirth'); }
    if (form.hasNationalId === null) { e.hasNationalId = true; missing.push('hasNationalId'); }
    if (form.hasNationalId === true) {
      if (!form.nationalId.trim())        { e.nationalId = true; missing.push('nationalId'); }
      if (!form.nationalIdCountry.trim()) { e.nationalIdCountry = true; missing.push('nationalIdCountry'); }
    }
    if (form.middleNames.length > MIDDLE_NAMES_MAX) {
      e.middleNames = true; missing.push('middleNames');
    }

    setErrors(e);
    return missing;
  };

  const handleSave = async () => {
    const missing = validate();
    if (missing.length > 0) {
      toast.error(t('visaIdentityValidationMissing'));
      return;
    }
    setSaving(true);
    try {
      // When hasUsedOtherNames=false we explicitly clear otherNames; same for
      // the national-id pair when hasNationalId=false. This keeps stale data
      // out of the encrypted column.
      const payload: Record<string, unknown> = {
        hasMononym:             form.hasMononym,
        middleNames:            form.middleNames.trim() || null,
        hasUsedOtherNames:      form.hasUsedOtherNames,
        otherNames:             form.hasUsedOtherNames ? form.otherNames.trim() : null,
        countryWhenSubmitting:  form.countryWhenSubmitting,
        prevAppliedNzVisa:      form.prevAppliedNzVisa,
        prevRequestedNzeta:     form.prevRequestedNzeta,
        everTravelledNz:        form.everTravelledNz,
        totalNzTime24Plus:      form.totalNzTime24Plus,
        passportIssueDate:      dateInputToIso(form.passportIssueDate),
        passportExpiryDate:     dateInputToIso(form.passportExpiryDate),
        passportCountryOfIssue: form.passportCountryOfIssue,
        passportGender:         form.passportGender,
        stateOfBirth:           form.stateOfBirth.trim(),
        cityOfBirth:            form.cityOfBirth.trim(),
        hasNationalId:          form.hasNationalId,
        nationalId:             form.hasNationalId ? form.nationalId.trim() : null,
        nationalIdCountry:      form.hasNationalId ? form.nationalIdCountry : null,
        currentStep:            2,
      };
      await patchVisa(payload);
      setSavedAt(new Date().toISOString());
      toast.success(t('visaIdentitySaveSuccess'));
    } catch {
      toast.error(t('visaIdentitySaveError'));
    } finally {
      setSaving(false);
    }
  };

  // ── Reusable building blocks ────────────────────────────────────────────

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

  const RedWarning = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
      {children}
    </div>
  );

  const inputClass = (hasError: boolean) =>
    [
      'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');

  const dobDisplay = readonly.dateOfBirth
    ? new Date(readonly.dateOfBirth).toISOString().slice(0, 10)
    : '';

  // ── JSX ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-sorena-navy">{t('visaIdentitySectionTitle')}</h2>

      {/* Saved confirmation banner */}
      {savedAt && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('visaIdentitySavedBanner')}
        </div>
      )}

      {/* Applicant name (read-only, from contacts) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ReadonlyField label={t('visaIdentityApplicantSurname')}   value={surname} />
        <ReadonlyField label={t('visaIdentityApplicantFirstName')} value={firstName} />
      </div>

      {/* ── Subsection: Identity information ─────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaIdentitySubsectionIdentityInfo')}</h3>
      </div>

      {/* 1. Mononym */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaIdentityMononymLabel')}<Asterisk />
        </p>
        <p className="text-sm text-sorena-navy/60">{t('visaIdentityMononymHelper')}</p>
        <YesNo
          value={form.hasMononym}
          onChange={(v) => update('hasMononym', v)}
          ariaInvalid={errors.hasMononym}
        />
      </div>

      {/* 2. Given/first name — RO */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaIdentityGivenNameLabel')}
        </label>
        <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaIdentityGivenNameHelper')}</p>
        <div className="rounded-lg border border-sorena-navy/10 bg-gray-50 px-3 py-2.5 text-sm text-sorena-navy/80">
          {firstName || <span className="italic text-sorena-navy/40">{t('visaCommonNotProvided')}</span>}
        </div>
      </div>

      {/* 3. Middle names — optional, max 30 */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaIdentityMiddleNamesLabel')}
        </label>
        <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaIdentityMiddleNamesHelper')}</p>
        <input
          type="text"
          value={form.middleNames}
          onChange={(e) => update('middleNames', e.target.value)}
          maxLength={MIDDLE_NAMES_MAX}
          placeholder={t('visaIdentityMiddleNamesPlaceholder')}
          className={inputClass(!!errors.middleNames)}
        />
      </div>

      {/* 4. Surname — RO */}
      <ReadonlyField label={t('visaIdentitySurnameLabel')} value={surname} />

      {/* INZ warning */}
      <RedWarning>{t('visaIdentityNameWarning')}</RedWarning>

      {/* 5. Used other names */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaIdentityUsedOtherNamesLabel')}<Asterisk />
        </p>
        <p className="text-sm text-sorena-navy/60">{t('visaIdentityUsedOtherNamesHelper')}</p>
        <YesNo
          value={form.hasUsedOtherNames}
          onChange={(v) => update('hasUsedOtherNames', v)}
          ariaInvalid={errors.hasUsedOtherNames}
        />
        {form.hasUsedOtherNames === true && (
          <div className="mt-2">
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaIdentityOtherNamesLabel')}<Asterisk />
            </label>
            <textarea
              rows={3}
              value={form.otherNames}
              onChange={(e) => update('otherNames', e.target.value)}
              placeholder={t('visaIdentityOtherNamesPlaceholder')}
              className={inputClass(!!errors.otherNames)}
            />
          </div>
        )}
      </div>

      {/* ── Subsection: NZ immigration history ───────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaIdentitySubsectionImmigration')}</h3>
      </div>

      {/* 6. Country when submitting */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaIdentityCountryWhenSubmittingLabel')}<Asterisk />
        </label>
        <SearchableSelect
          options={COUNTRIES}
          value={form.countryWhenSubmitting}
          onChange={(v) => update('countryWhenSubmitting', v)}
          placeholder={t('visaCommonCountryPlaceholder')}
          hasError={errors.countryWhenSubmitting}
        />
      </div>

      {/* 7-10 booleans */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaIdentityPrevAppliedNzVisaLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.prevAppliedNzVisa}
          onChange={(v) => update('prevAppliedNzVisa', v)}
          ariaInvalid={errors.prevAppliedNzVisa}
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaIdentityPrevRequestedNzetaLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.prevRequestedNzeta}
          onChange={(v) => update('prevRequestedNzeta', v)}
          ariaInvalid={errors.prevRequestedNzeta}
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaIdentityEverTravelledNzLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.everTravelledNz}
          onChange={(v) => update('everTravelledNz', v)}
          ariaInvalid={errors.everTravelledNz}
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaIdentityTotalNzTime24PlusLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.totalNzTime24Plus}
          onChange={(v) => update('totalNzTime24Plus', v)}
          ariaInvalid={errors.totalNzTime24Plus}
        />
      </div>

      {/* ── Subsection: Passport and birth details ───────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaIdentitySubsectionPassport')}</h3>
        <p className="mt-1 text-sm text-sorena-navy/60">{t('visaIdentityPassportIntro')}</p>
      </div>

      {/* 11. Passport number — RO */}
      <ReadonlyField
        label={t('visaIdentityPassportNumberLabel')}
        value={readonly.passportNumber ?? ''}
      />

      {/* 12. Nationality — RO */}
      <ReadonlyField
        label={t('visaIdentityNationalityLabel')}
        value={readonly.citizenship ?? ''}
      />

      {/* 13. Country of issue */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaIdentityPassportCountryOfIssueLabel')}<Asterisk />
        </label>
        <SearchableSelect
          options={COUNTRIES}
          value={form.passportCountryOfIssue}
          onChange={(v) => update('passportCountryOfIssue', v)}
          placeholder={t('visaCommonCountryPlaceholder')}
          hasError={errors.passportCountryOfIssue}
        />
      </div>

      {/* 14-15. Issue / expiry dates */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaIdentityPassportIssueDateLabel')}<Asterisk />
          </label>
          <input
            type="date"
            value={form.passportIssueDate}
            onChange={(e) => update('passportIssueDate', e.target.value)}
            className={inputClass(!!errors.passportIssueDate)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaIdentityPassportExpiryDateLabel')}<Asterisk />
          </label>
          <input
            type="date"
            value={form.passportExpiryDate}
            onChange={(e) => update('passportExpiryDate', e.target.value)}
            className={inputClass(!!errors.passportExpiryDate)}
          />
        </div>
      </div>

      {/* 16. Gender */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaIdentityGenderLabel')}<Asterisk />
        </label>
        <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaIdentityGenderHelper')}</p>
        <select
          value={form.passportGender}
          onChange={(e) => update('passportGender', e.target.value)}
          className={inputClass(!!errors.passportGender)}
        >
          <option value="" disabled>{t('visaIdentityGenderPlaceholder')}</option>
          {GENDER_OPTIONS.map(({ value, key }) => (
            <option key={value} value={value}>{t(key)}</option>
          ))}
        </select>
      </div>

      {/* 17. DOB — RO */}
      <ReadonlyField label={t('visaIdentityDateOfBirthLabel')} value={dobDisplay} />

      {/* INZ warning #2 */}
      <RedWarning>{t('visaIdentityPassportWarning')}</RedWarning>

      {/* 18. Country of birth — RO */}
      <ReadonlyField
        label={t('visaIdentityCountryOfBirthLabel')}
        value={readonly.countryOfBirth ?? ''}
      />

      {/* 19. State of birth */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaIdentityStateOfBirthLabel')}<Asterisk />
        </label>
        <input
          type="text"
          value={form.stateOfBirth}
          onChange={(e) => update('stateOfBirth', e.target.value)}
          placeholder={t('visaIdentityStateOfBirthPlaceholder')}
          className={inputClass(!!errors.stateOfBirth)}
        />
      </div>

      {/* 20. City of birth */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaIdentityCityOfBirthLabel')}<Asterisk />
        </label>
        <input
          type="text"
          value={form.cityOfBirth}
          onChange={(e) => update('cityOfBirth', e.target.value)}
          placeholder={t('visaIdentityCityOfBirthPlaceholder')}
          className={inputClass(!!errors.cityOfBirth)}
        />
      </div>

      {/* ── Subsection: National identity ────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaIdentitySubsectionNationalId')}</h3>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaIdentityHasNationalIdLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.hasNationalId}
          onChange={(v) => update('hasNationalId', v)}
          ariaInvalid={errors.hasNationalId}
        />
        {form.hasNationalId === true && (
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                {t('visaIdentityNationalIdNumberLabel')}<Asterisk />
              </label>
              <input
                type="text"
                value={form.nationalId}
                onChange={(e) => update('nationalId', e.target.value)}
                placeholder={t('visaIdentityNationalIdNumberPlaceholder')}
                className={inputClass(!!errors.nationalId)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                {t('visaIdentityNationalIdCountryLabel')}<Asterisk />
              </label>
              <SearchableSelect
                options={COUNTRIES}
                value={form.nationalIdCountry}
                onChange={(v) => update('nationalIdCountry', v)}
                placeholder={t('visaCommonCountryPlaceholder')}
                hasError={errors.nationalIdCountry}
              />
            </div>
          </div>
        )}
      </div>

      {/* Save button */}
      <div className="flex justify-end border-t border-sorena-navy/10 pt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-sorena-navy px-6 py-2 text-base font-semibold text-white transition-colors hover:bg-sorena-navy/90 disabled:opacity-40"
        >
          {saving ? t('visaCommonSaving') : t('visaIdentitySaveButton')}
        </button>
      </div>
    </div>
  );
}
