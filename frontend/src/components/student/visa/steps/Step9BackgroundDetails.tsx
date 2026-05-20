'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useVisa } from '../VisaFormContext';

// PR-VISA9 — INZ 1200 Section 9 "Background details".
// Flat list of ten Y/N declarations grouped into six subsections.
// No repeating tables, no uploads, no encryption — just booleans.

// Each entry pairs a column key on visa_applications with the i18n
// keys for the question label and optional subsection heading. Driving
// the JSX from a table keeps the component compact and the Save
// payload trivially derivable. Subsection headings render before the
// first row that carries one.
const QUESTIONS: ReadonlyArray<{
  field:
    | 'heldReligiousCulturalPosition'
    | 'heldPoliticalAppointment'
    | 'hadPoliticalAssociation'
    | 'associatedIntelligenceAgency'
    | 'witnessedIllTreatment'
    | 'involvedArmedConflict'
    | 'associatedViolentGroup'
    | 'involvedWarCrimes'
    | 'memberLiberationMilitia'
    | 'everDetainedImprisoned';
  labelKey: string;
  subsectionKey?: string;
}> = [
  { subsectionKey: 'visaBackgroundSubsectionCultural',     field: 'heldReligiousCulturalPosition', labelKey: 'visaBackgroundQ1Label' },
  { subsectionKey: 'visaBackgroundSubsectionPoliticalApp', field: 'heldPoliticalAppointment',      labelKey: 'visaBackgroundQ2Label' },
  { subsectionKey: 'visaBackgroundSubsectionPoliticalAssoc', field: 'hadPoliticalAssociation',     labelKey: 'visaBackgroundQ3Label' },
  { subsectionKey: 'visaBackgroundSubsectionOther',        field: 'associatedIntelligenceAgency',  labelKey: 'visaBackgroundQ4Label' },
  {                                                        field: 'witnessedIllTreatment',         labelKey: 'visaBackgroundQ5Label' },
  {                                                        field: 'involvedArmedConflict',         labelKey: 'visaBackgroundQ6Label' },
  {                                                        field: 'associatedViolentGroup',        labelKey: 'visaBackgroundQ7Label' },
  {                                                        field: 'involvedWarCrimes',             labelKey: 'visaBackgroundQ8Label' },
  { subsectionKey: 'visaBackgroundSubsectionMilitia',      field: 'memberLiberationMilitia',       labelKey: 'visaBackgroundQ9Label' },
  { subsectionKey: 'visaBackgroundSubsectionDetention',    field: 'everDetainedImprisoned',        labelKey: 'visaBackgroundQ10Label' },
];

type BgField = (typeof QUESTIONS)[number]['field'];

export function Step9BackgroundDetails() {
  const t = useTranslations();
  const { visa, patchVisa, setActiveStep, savedAt, setSavedAt } = useVisa();

  const initial = useMemo<Record<BgField, boolean | null>>(() => ({
    heldReligiousCulturalPosition: visa.heldReligiousCulturalPosition,
    heldPoliticalAppointment:      visa.heldPoliticalAppointment,
    hadPoliticalAssociation:       visa.hadPoliticalAssociation,
    associatedIntelligenceAgency:  visa.associatedIntelligenceAgency,
    witnessedIllTreatment:         visa.witnessedIllTreatment,
    involvedArmedConflict:         visa.involvedArmedConflict,
    associatedViolentGroup:        visa.associatedViolentGroup,
    involvedWarCrimes:             visa.involvedWarCrimes,
    memberLiberationMilitia:       visa.memberLiberationMilitia,
    everDetainedImprisoned:        visa.everDetainedImprisoned,
  }), [visa]);

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const update = (field: BgField, v: boolean) => {
    setForm((prev) => ({ ...prev, [field]: v }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: false }));
  };

  const validate = (): string[] => {
    const missing: string[] = [];
    const e: Record<string, boolean> = {};
    for (const { field } of QUESTIONS) {
      if (form[field] === null) {
        e[field] = true;
        missing.push(field);
      }
    }
    setErrors(e);
    return missing;
  };

  const handleSave = async () => {
    if (validate().length > 0) {
      toast.error(t('visaBackgroundValidationMissing'));
      return;
    }
    setSaving(true);
    try {
      await patchVisa({ ...form, currentStep: 10 });
      setSavedAt(new Date().toISOString());
      toast.success(t('visaBackgroundSaveSuccess'));
    } catch {
      toast.error(t('visaBackgroundSaveError'));
    } finally {
      setSaving(false);
    }
  };

  // ── Building blocks (mirror steps 1-8) ────────────────────────────

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

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-sorena-navy">{t('visaBackgroundSectionTitle')}</h2>
      <p className="text-sm text-sorena-navy/70">{t('visaBackgroundIntro')}</p>

      {savedAt && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('visaBackgroundSavedBanner')}
        </div>
      )}

      {QUESTIONS.map(({ field, labelKey, subsectionKey }) => (
        <div key={field} className="flex flex-col gap-2">
          {subsectionKey && (
            <div className="mt-2 border-t border-sorena-navy/10 pt-6">
              <h3 className="text-xl font-bold text-sorena-navy">
                {t(subsectionKey as Parameters<typeof t>[0])}
              </h3>
            </div>
          )}
          <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t(labelKey as Parameters<typeof t>[0])}<Asterisk />
          </p>
          <YesNo
            value={form[field]}
            onChange={(v) => update(field, v)}
            ariaInvalid={!!errors[field]}
          />
        </div>
      ))}

      {/* Back + Save row */}
      <div className="flex items-center justify-between border-t border-sorena-navy/10 pt-4">
        <button
          type="button"
          onClick={() => setActiveStep(8)}
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
          {saving ? t('visaCommonSaving') : t('visaBackgroundSaveButton')}
        </button>
      </div>
    </div>
  );
}
