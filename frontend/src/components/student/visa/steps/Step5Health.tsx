'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { useVisa } from '../VisaFormContext';
import { COUNTRIES } from '@/lib/data/countries';
import { SearchableSelect } from '@/components/common/SearchableSelect';

// PR-VISA5 — INZ 1200 Section 5 "Health".
// Layout mirrors INZ exactly. Reuses the established blue NOTE, helper,
// country dropdown, Yes/No control, repeating-table add/remove UX, and
// inline-error styling from PR-VISA1/2/3/4.

const LENGTH_OF_STAY_OPTIONS = [
  { value: 'SIX_MONTHS_OR_LESS',     key: 'visaHealthLengthSixOrLess'   as const },
  { value: 'SIX_TO_TWELVE_MONTHS',   key: 'visaHealthLengthSixToTwelve' as const },
  { value: 'MORE_THAN_TWELVE_MONTHS', key: 'visaHealthLengthMoreThanTwelve' as const },
];

export function Step5Health() {
  const t = useTranslations();
  const {
    visa,
    patchVisa,
    setActiveStep,
    savedAt,
    setSavedAt,
    tbRiskCountries,
    addTbRiskCountry,
    updateTbRiskCountry,
    deleteTbRiskCountry,
  } = useVisa();

  const initial = useMemo(() => ({
    hasTuberculosis:              visa.hasTuberculosis,
    needsRenalDialysis:           visa.needsRenalDialysis,
    hasMedicalCondition:          visa.hasMedicalCondition,
    needsResidentialCare:         visa.needsResidentialCare,
    isPregnant:                   visa.isPregnant,
    intendedLengthOfStay:         visa.intendedLengthOfStay ?? '',
    hadMedicalExam:               visa.hadMedicalExam,
    medicalRefNumber:             visa.medicalRefNumber ?? '',
    tbCountriesNoMore:            visa.tbCountriesNoMore ?? false,
    insuranceDeclarationAgreed:   visa.insuranceDeclarationAgreed ?? false,
    publicHealthAckAgreed:        visa.publicHealthAckAgreed ?? false,
  }), [visa]);

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [addingTb, setAddingTb] = useState(false);

  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key as string]) setErrors((prev) => ({ ...prev, [key as string]: false }));
  };

  const hadExam = form.hadMedicalExam === true;

  // ── TB-risk row handlers (live-API, mirrors Step 4 citizenships) ──

  const handleAddTb = async () => {
    if (addingTb) return;
    setAddingTb(true);
    try {
      await addTbRiskCountry({ country: '', totalDurationDays: 0 });
    } catch {
      toast.error(t('visaHealthTbAddError'));
    } finally {
      setAddingTb(false);
    }
  };

  const handleTbCountry = async (id: string, country: string) => {
    if (errors[`tbCountry:${id}`]) {
      setErrors((prev) => ({ ...prev, [`tbCountry:${id}`]: false }));
    }
    try {
      await updateTbRiskCountry(id, { country });
    } catch {
      toast.error(t('visaHealthTbUpdateError'));
    }
  };

  const handleTbDuration = async (id: string, raw: string) => {
    if (errors[`tbDuration:${id}`]) {
      setErrors((prev) => ({ ...prev, [`tbDuration:${id}`]: false }));
    }
    const parsed = raw.trim() === '' ? 0 : parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      toast.error(t('visaHealthTbDurationInvalid'));
      return;
    }
    try {
      await updateTbRiskCountry(id, { totalDurationDays: parsed });
    } catch {
      toast.error(t('visaHealthTbUpdateError'));
    }
  };

  const handleRemoveTb = async (id: string) => {
    if (!window.confirm(t('visaHealthTbRemoveConfirm'))) return;
    try {
      await deleteTbRiskCountry(id);
    } catch {
      toast.error(t('visaHealthTbRemoveError'));
    }
  };

  const validate = (): string[] => {
    const missing: string[] = [];
    const e: Record<string, boolean> = {};

    if (form.hasTuberculosis === null)      { e.hasTuberculosis = true;      missing.push('hasTuberculosis'); }
    if (form.needsRenalDialysis === null)   { e.needsRenalDialysis = true;   missing.push('needsRenalDialysis'); }
    if (form.hasMedicalCondition === null)  { e.hasMedicalCondition = true;  missing.push('hasMedicalCondition'); }
    if (form.needsResidentialCare === null) { e.needsResidentialCare = true; missing.push('needsResidentialCare'); }
    if (form.isPregnant === null)           { e.isPregnant = true;           missing.push('isPregnant'); }
    if (!form.intendedLengthOfStay)         { e.intendedLengthOfStay = true; missing.push('intendedLengthOfStay'); }
    if (form.hadMedicalExam === null)       { e.hadMedicalExam = true;       missing.push('hadMedicalExam'); }
    if (hadExam && !form.medicalRefNumber.trim()) {
      e.medicalRefNumber = true; missing.push('medicalRefNumber');
    }

    // TB-risk countries: ≥1 row OR the "no more" checkbox ticked.
    if (tbRiskCountries.length === 0 && !form.tbCountriesNoMore) {
      e.tbCountriesEmpty = true; missing.push('tbCountriesEmpty');
    }
    // Per-row: non-empty country + positive duration.
    for (const row of tbRiskCountries) {
      if (!row.country?.trim()) {
        e[`tbCountry:${row.id}`] = true;
        missing.push(`tbCountry:${row.id}`);
      }
      if (!Number.isInteger(row.totalDurationDays) || row.totalDurationDays <= 0) {
        e[`tbDuration:${row.id}`] = true;
        missing.push(`tbDuration:${row.id}`);
      }
    }

    if (!form.insuranceDeclarationAgreed) {
      e.insuranceDeclarationAgreed = true; missing.push('insuranceDeclarationAgreed');
    }
    if (!form.publicHealthAckAgreed) {
      e.publicHealthAckAgreed = true; missing.push('publicHealthAckAgreed');
    }

    setErrors(e);
    return missing;
  };

  const handleSave = async () => {
    const missing = validate();
    if (missing.length > 0) {
      toast.error(t('visaHealthValidationMissing'));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        hasTuberculosis:              form.hasTuberculosis,
        needsRenalDialysis:           form.needsRenalDialysis,
        hasMedicalCondition:          form.hasMedicalCondition,
        needsResidentialCare:         form.needsResidentialCare,
        isPregnant:                   form.isPregnant,
        intendedLengthOfStay:         form.intendedLengthOfStay,
        hadMedicalExam:               form.hadMedicalExam,
        // Server clears medicalRefNumber when hadMedicalExam=false; we
        // still pass the trimmed value when Yes so the upsert writes it.
        medicalRefNumber:             hadExam ? form.medicalRefNumber.trim() : null,
        tbCountriesNoMore:            form.tbCountriesNoMore,
        insuranceDeclarationAgreed:   form.insuranceDeclarationAgreed,
        publicHealthAckAgreed:        form.publicHealthAckAgreed,
        // No Step 6 yet — bump so the stepper opens cleanly there later.
        currentStep:                  6,
      };
      await patchVisa(payload);
      setSavedAt(new Date().toISOString());
      toast.success(t('visaHealthSaveSuccess'));
      // PR-VISA6: advance the stepper now that Section 6 exists.
      setActiveStep(6);
    } catch {
      toast.error(t('visaHealthSaveError'));
    } finally {
      setSaving(false);
    }
  };

  // ── Reusable building blocks ──────────────────────────────────────────

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

  const InfoNote = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
      <p className="mb-1 font-bold uppercase tracking-wide">{t('visaCommonNoteLabel')}</p>
      {children}
    </div>
  );

  const inputClass = (hasError: boolean) =>
    [
      'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');
  const narrowInputClass = (hasError: boolean) =>
    [
      'w-44 rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-sorena-navy">{t('visaHealthSectionTitle')}</h2>
      <p className="text-sm text-sorena-navy/70">{t('visaHealthIntro')}</p>

      {savedAt && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('visaHealthSavedBanner')}
        </div>
      )}

      {/* ── Subsection: Guidance ──────────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaHealthSubsectionGuidance')}</h3>
      </div>
      <InfoNote>{t('visaHealthGuidanceNote')}</InfoNote>

      {/* ── Subsection: Tuberculosis ──────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaHealthSubsectionTuberculosis')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaHealthHasTbLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.hasTuberculosis}
          onChange={(v) => update('hasTuberculosis', v)}
          ariaInvalid={errors.hasTuberculosis}
        />
      </div>

      {/* ── Subsection: Medical care during stay ──────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaHealthSubsectionMedicalCare')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaHealthRenalDialysisLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.needsRenalDialysis}
          onChange={(v) => update('needsRenalDialysis', v)}
          ariaInvalid={errors.needsRenalDialysis}
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaHealthMedicalConditionLabel')}<Asterisk />
        </p>
        <p className="text-sm text-sorena-navy/60">{t('visaHealthMedicalConditionHelper')}</p>
        <YesNo
          value={form.hasMedicalCondition}
          onChange={(v) => update('hasMedicalCondition', v)}
          ariaInvalid={errors.hasMedicalCondition}
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaHealthResidentialCareLabel')}<Asterisk />
        </p>
        <p className="text-sm text-sorena-navy/60">{t('visaHealthResidentialCareHelper')}</p>
        <YesNo
          value={form.needsResidentialCare}
          onChange={(v) => update('needsResidentialCare', v)}
          ariaInvalid={errors.needsResidentialCare}
        />
      </div>

      {/* ── Subsection: Pregnancy ─────────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaHealthSubsectionPregnancy')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaHealthIsPregnantLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.isPregnant}
          onChange={(v) => update('isPregnant', v)}
          ariaInvalid={errors.isPregnant}
        />
      </div>

      {/* ── Subsection: Length of stay ────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaHealthSubsectionLengthOfStay')}</h3>
        <p className="mt-2 text-sm text-sorena-navy/70">{t('visaHealthLengthHelperIntro')}</p>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaHealthLengthLabel')}<Asterisk />
        </label>
        <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaHealthLengthHelperCount')}</p>
        <select
          value={form.intendedLengthOfStay}
          onChange={(e) => update('intendedLengthOfStay', e.target.value)}
          className={inputClass(!!errors.intendedLengthOfStay)}
        >
          <option value="" disabled>{t('visaCommonSelectPlaceholder')}</option>
          {LENGTH_OF_STAY_OPTIONS.map(({ value, key }) => (
            <option key={value} value={value}>{t(key)}</option>
          ))}
        </select>
      </div>

      {/* ── Subsection: Medical examinations ──────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaHealthSubsectionMedicalExams')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaHealthHadMedicalExamLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.hadMedicalExam}
          onChange={(v) => update('hadMedicalExam', v)}
          ariaInvalid={errors.hadMedicalExam}
        />
        {hadExam && (
          <div className="mt-2">
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaHealthMedicalRefLabel')}<Asterisk />
            </label>
            <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaHealthMedicalRefHelper')}</p>
            <input
              type="text"
              value={form.medicalRefNumber}
              onChange={(e) => update('medicalRefNumber', e.target.value)}
              className={inputClass(!!errors.medicalRefNumber)}
            />
          </div>
        )}
      </div>

      {/* ── Subsection: TB risk countries ─────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaHealthSubsectionTbRisk')}</h3>
      </div>
      <InfoNote>{t('visaHealthTbRiskNote')}</InfoNote>
      <p className="text-sm font-bold text-sorena-navy">{t('visaHealthTbRiskHeading')}</p>

      {errors.tbCountriesEmpty && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {t('visaHealthTbAtLeastOneOrNoMore')}
        </div>
      )}

      {tbRiskCountries.map((row, idx) => (
        <div
          key={row.id}
          className="flex flex-col gap-3 rounded-xl border border-sorena-navy/10 bg-white p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
              {t('visaHealthTbRowHeading', { n: idx + 1 })}
            </h4>
            <button
              type="button"
              onClick={() => handleRemoveTb(row.id)}
              title={t('visaHealthTbRemoveTooltip')}
              className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500"
            >
              <Trash2 size={16} />
            </button>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaHealthTbCountryLabel')}<Asterisk />
            </label>
            <SearchableSelect
              options={COUNTRIES}
              value={row.country ?? ''}
              onChange={(v) => handleTbCountry(row.id, v)}
              placeholder={t('visaCommonCountryPlaceholder')}
              hasError={!!errors[`tbCountry:${row.id}`]}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaHealthTbDurationLabel')}<Asterisk />
            </label>
            <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaHealthTbDurationHelper')}</p>
            <input
              type="number"
              min={1}
              defaultValue={row.totalDurationDays === 0 ? '' : String(row.totalDurationDays)}
              onBlur={(e) => handleTbDuration(row.id, e.target.value)}
              placeholder="183"
              className={narrowInputClass(!!errors[`tbDuration:${row.id}`])}
            />
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={handleAddTb}
        disabled={addingTb}
        className="self-start rounded-lg border border-dashed border-sorena-navy/30 px-4 py-2 text-sm font-medium text-sorena-navy transition-colors hover:bg-sorena-navy/5 disabled:opacity-40"
      >
        + {t('visaHealthTbAddButton')}
      </button>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-sorena-navy/10 bg-white px-4 py-3">
        <input
          type="checkbox"
          checked={form.tbCountriesNoMore}
          onChange={(e) => update('tbCountriesNoMore', e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-sorena-navy/20 accent-sorena-navy"
        />
        <span className="text-sm text-sorena-navy/80">{t('visaHealthTbNoMoreLabel')}</span>
      </label>

      {/* ── Subsection: Insurance declaration ─────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaHealthSubsectionInsurance')}</h3>
      </div>
      <p className="text-sm text-sorena-navy/70">{t('visaHealthInsuranceIntro')}</p>
      <div className="flex flex-col gap-3 rounded-xl border border-sorena-navy/10 bg-white p-5">
        <p className="text-sm leading-relaxed text-sorena-navy/80">{t('visaHealthInsuranceP1')}</p>
        <p className="text-sm leading-relaxed text-sorena-navy/80">{t('visaHealthInsuranceP2')}</p>
        <p className="text-sm leading-relaxed text-sorena-navy/80">{t('visaHealthInsuranceP3')}</p>
      </div>
      <label
        className={[
          'flex cursor-pointer items-start gap-3 rounded-lg border bg-white px-4 py-3',
          errors.insuranceDeclarationAgreed ? 'border-red-400' : 'border-sorena-navy/10',
        ].join(' ')}
      >
        <input
          type="checkbox"
          checked={form.insuranceDeclarationAgreed}
          onChange={(e) => update('insuranceDeclarationAgreed', e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-sorena-navy/20 accent-sorena-navy"
        />
        <span className="text-sm text-sorena-navy/80">
          {t('visaHealthInsuranceAgreeLabel')}<Asterisk />
        </span>
      </label>

      {/* ── Subsection: Public health acknowledgement ─────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaHealthSubsectionPublicHealth')}</h3>
      </div>
      <label
        className={[
          'flex cursor-pointer items-start gap-3 rounded-lg border bg-white px-4 py-3',
          errors.publicHealthAckAgreed ? 'border-red-400' : 'border-sorena-navy/10',
        ].join(' ')}
      >
        <input
          type="checkbox"
          checked={form.publicHealthAckAgreed}
          onChange={(e) => update('publicHealthAckAgreed', e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-sorena-navy/20 accent-sorena-navy"
        />
        <span className="text-sm text-sorena-navy/80">
          {t('visaHealthPublicHealthAckLabel')}<Asterisk />
        </span>
      </label>

      {/* Back + Save row */}
      <div className="flex items-center justify-between border-t border-sorena-navy/10 pt-4">
        <button
          type="button"
          onClick={() => setActiveStep(4)}
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
          {saving ? t('visaCommonSaving') : t('visaHealthSaveButton')}
        </button>
      </div>
    </div>
  );
}
