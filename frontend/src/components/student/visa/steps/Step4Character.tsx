'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { useVisa } from '../VisaFormContext';
import { COUNTRIES } from '@/lib/data/countries';
import { SearchableSelect } from '@/components/common/SearchableSelect';
import { VisaDocumentUploader } from '../VisaDocumentUploader';
import { DateInput } from '@/components/ui/DateInput';

// PR-VISA4 — INZ 1200 Section 4 "Character".
// Layout mirrors INZ exactly: four character declarations, then police
// certificate (from country of citizenship — single upload + 3 metadata
// fields), then other-citizenships Y/N, then lived-5+-years-elsewhere Y/N.
// Reuses the established NOTE (blue), ALERT (green), helper, country
// dropdown, and compact-date styling from PR-VISA1/2/3.

function isoToDateInput(iso: string | null): string {
  return (iso ?? '').slice(0, 10);
}
function dateInputToIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

// Module-scope current year — used as a bound on DateInput.
const CURRENT_YEAR = new Date().getFullYear();

export function Step4Character() {
  const t = useTranslations();
  const {
    visa,
    patchVisa,
    setActiveStep,
    savedAt,
    setSavedAt,
    otherCitizenships,
    addOtherCitizenship,
    updateOtherCitizenship,
    deleteOtherCitizenship,
  } = useVisa();

  const initial = useMemo(() => ({
    everConvicted:                visa.everConvicted,
    underInvestigation:           visa.underInvestigation,
    everDeportedExcluded:         visa.everDeportedExcluded,
    everRefusedVisa:              visa.everRefusedVisa,
    policeCertIssueDate:          isoToDateInput(visa.policeCertIssueDate),
    policeCertCountryOfIssue:     visa.policeCertCountryOfIssue ?? '',
    policeCertInEnglish:          visa.policeCertInEnglish,
    holdsOtherCitizenships:       visa.holdsOtherCitizenships,
    livedOtherCountry5Years:      visa.livedOtherCountry5Years,
  }), [visa]);

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  // Tracked by VisaDocumentUploader (initial fetch on mount + every
  // upload/delete). Save is blocked until at least one police certificate
  // exists for this user/case.
  const [policeCertCount, setPoliceCertCount] = useState(0);
  // Debounce against double-click on Add — each click is its own API
  // call, so we disable the button while one is in flight.
  const [addingCitizenship, setAddingCitizenship] = useState(false);

  // ── Other-citizenship row handlers (live-API, same shape as admission's
  // education-entries handlers). Toggling the parent Y/N to No is handled
  // server-side on Save — see the reconcile block in visa.service.

  const handleAddCitizenship = async () => {
    if (addingCitizenship) return;
    setAddingCitizenship(true);
    try {
      // Default the new row to no country + passport=false; the student
      // fills it in before Save.
      await addOtherCitizenship({ country: '', holdsPassport: false });
    } catch {
      toast.error(t('visaCharacterCitizenshipAddError'));
    } finally {
      setAddingCitizenship(false);
    }
  };

  const handleCitizenshipCountry = async (id: string, country: string) => {
    if (errors[`citizenshipCountry:${id}`]) {
      setErrors((prev) => ({ ...prev, [`citizenshipCountry:${id}`]: false }));
    }
    try {
      await updateOtherCitizenship(id, { country });
    } catch {
      toast.error(t('visaCharacterCitizenshipUpdateError'));
    }
  };

  const handleCitizenshipPassport = async (id: string, holdsPassport: boolean) => {
    if (errors[`citizenshipPassport:${id}`]) {
      setErrors((prev) => ({ ...prev, [`citizenshipPassport:${id}`]: false }));
    }
    try {
      await updateOtherCitizenship(id, { holdsPassport });
    } catch {
      toast.error(t('visaCharacterCitizenshipUpdateError'));
    }
  };

  const handleRemoveCitizenship = async (id: string) => {
    if (!window.confirm(t('visaCharacterCitizenshipRemoveConfirm'))) return;
    try {
      await deleteOtherCitizenship(id);
    } catch {
      toast.error(t('visaCharacterCitizenshipRemoveError'));
    }
  };

  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key as string]) setErrors((prev) => ({ ...prev, [key as string]: false }));
  };

  const validate = (): string[] => {
    const missing: string[] = [];
    const e: Record<string, boolean> = {};

    // Four character declarations — all mandatory.
    if (form.everConvicted === null)        { e.everConvicted = true;        missing.push('everConvicted'); }
    if (form.underInvestigation === null)   { e.underInvestigation = true;   missing.push('underInvestigation'); }
    if (form.everDeportedExcluded === null) { e.everDeportedExcluded = true; missing.push('everDeportedExcluded'); }
    if (form.everRefusedVisa === null)      { e.everRefusedVisa = true;      missing.push('everRefusedVisa'); }

    // Police certificate from country of citizenship — file + 3 fields.
    if (policeCertCount === 0)              { e.policeCert = true;              missing.push('policeCert'); }
    if (!form.policeCertIssueDate)          { e.policeCertIssueDate = true;     missing.push('policeCertIssueDate'); }
    if (!form.policeCertCountryOfIssue.trim()) {
      e.policeCertCountryOfIssue = true; missing.push('policeCertCountryOfIssue');
    }
    if (form.policeCertInEnglish === null)  { e.policeCertInEnglish = true; missing.push('policeCertInEnglish'); }

    // Other citizenships + 5+ years gates.
    if (form.holdsOtherCitizenships === null)  { e.holdsOtherCitizenships = true;  missing.push('holdsOtherCitizenships'); }
    if (form.holdsOtherCitizenships === true) {
      // At least one row required, and every row needs its two fields.
      if (otherCitizenships.length === 0) {
        e.otherCitizenshipsEmpty = true; missing.push('otherCitizenshipsEmpty');
      } else {
        for (const row of otherCitizenships) {
          if (!row.country?.trim()) {
            e[`citizenshipCountry:${row.id}`] = true;
            missing.push(`citizenshipCountry:${row.id}`);
          }
          if (typeof row.holdsPassport !== 'boolean') {
            e[`citizenshipPassport:${row.id}`] = true;
            missing.push(`citizenshipPassport:${row.id}`);
          }
        }
      }
    }
    if (form.livedOtherCountry5Years === null) { e.livedOtherCountry5Years = true; missing.push('livedOtherCountry5Years'); }

    setErrors(e);
    return missing;
  };

  const handleSave = async () => {
    const missing = validate();
    if (missing.length > 0) {
      toast.error(t('visaCharacterValidationMissing'));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        everConvicted:                form.everConvicted,
        underInvestigation:           form.underInvestigation,
        everDeportedExcluded:         form.everDeportedExcluded,
        everRefusedVisa:              form.everRefusedVisa,
        policeCertIssueDate:          dateInputToIso(form.policeCertIssueDate),
        policeCertCountryOfIssue:     form.policeCertCountryOfIssue,
        policeCertInEnglish:          form.policeCertInEnglish,
        holdsOtherCitizenships:       form.holdsOtherCitizenships,
        livedOtherCountry5Years:      form.livedOtherCountry5Years,
        // No Step 5 yet — bump so the stepper opens cleanly there later.
        currentStep:                  5,
      };
      await patchVisa(payload);
      setSavedAt(new Date().toISOString());
      toast.success(t('visaCharacterSaveSuccess'));
      // PR-VISA5: advance the stepper now that Section 5 exists.
      setActiveStep(5);
    } catch {
      toast.error(t('visaCharacterSaveError'));
    } finally {
      setSaving(false);
    }
  };

  // ── Reusable building blocks (mirror Step 1/2/3) ────────────────────────

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
  const dateInputClass = (hasError: boolean) =>
    [
      'w-44 rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-sorena-navy">{t('visaCharacterSectionTitle')}</h2>
      <p className="text-sm text-sorena-navy/70">{t('visaCharacterIntro')}</p>

      {savedAt && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('visaCharacterSavedBanner')}
        </div>
      )}

      {/* ── Subsection: Character details ─────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaCharacterSubsectionDetails')}</h3>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaCharacterEverConvictedLabel')}<Asterisk />
        </p>
        <p className="text-sm text-sorena-navy/60">{t('visaCharacterEverConvictedHelper')}</p>
        <YesNo
          value={form.everConvicted}
          onChange={(v) => update('everConvicted', v)}
          ariaInvalid={errors.everConvicted}
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaCharacterUnderInvestigationLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.underInvestigation}
          onChange={(v) => update('underInvestigation', v)}
          ariaInvalid={errors.underInvestigation}
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaCharacterEverDeportedLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.everDeportedExcluded}
          onChange={(v) => update('everDeportedExcluded', v)}
          ariaInvalid={errors.everDeportedExcluded}
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaCharacterEverRefusedVisaLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.everRefusedVisa}
          onChange={(v) => update('everRefusedVisa', v)}
          ariaInvalid={errors.everRefusedVisa}
        />
      </div>

      {/* ── Subsection: Police certificates ───────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaCharacterSubsectionPoliceCerts')}</h3>
      </div>

      <p className="text-sm font-bold text-sorena-navy">{t('visaCharacterPoliceCertCitizenshipHeading')}</p>
      <p className="text-sm text-sorena-navy/70">{t('visaCharacterPoliceCertIntro')}</p>

      <InfoNote>{t('visaCharacterPoliceCertWebsiteNote')}</InfoNote>

      <p className="text-sm font-bold text-sorena-navy">{t('visaCharacterFijiHongKongIsraelHeading')}</p>
      <p className="text-sm text-sorena-navy/70">{t('visaCharacterFijiHongKongIsraelBody')}</p>

      <InfoNote>{t('visaCharacterNotCitizenOfPassportNote')}</InfoNote>

      <p className="text-sm text-sorena-navy/70">{t('visaCharacterForExampleIntro')}</p>
      <ul className="-mt-3 list-disc space-y-1 pl-6 text-sm text-sorena-navy/70">
        <li>{t('visaCharacterAmericanSamoaExample')}</li>
        <li>{t('visaCharacterBritishNationalExample')}</li>
      </ul>

      {/* 5. Upload police certificate */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaCharacterUploadPoliceCertLabel')}<Asterisk />
        </label>
        <VisaDocumentUploader
          documentType="VISA_POLICE_CERTIFICATE"
          hasError={!!errors.policeCert}
          onChange={setPoliceCertCount}
          single={true}
        />
      </div>

      {/* 6. Issue date — compact */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaCharacterPoliceCertIssueDateLabel')}<Asterisk />
        </label>
        <DateInput
          value={form.policeCertIssueDate || null}
          onChange={(iso) => update('policeCertIssueDate', iso ?? '')}
          minYear={1900}
          maxYear={CURRENT_YEAR}
          ariaInvalid={!!errors.policeCertIssueDate}
        />
      </div>

      {/* 7. Country of issue */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaCharacterPoliceCertCountryOfIssueLabel')}<Asterisk />
        </label>
        <SearchableSelect
          options={COUNTRIES}
          value={form.policeCertCountryOfIssue}
          onChange={(v) => update('policeCertCountryOfIssue', v)}
          placeholder={t('visaCommonCountryPlaceholder')}
          hasError={errors.policeCertCountryOfIssue}
        />
      </div>

      {/* 8. Is this document in English? */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaCharacterPoliceCertInEnglishLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.policeCertInEnglish}
          onChange={(v) => update('policeCertInEnglish', v)}
          ariaInvalid={errors.policeCertInEnglish}
        />
      </div>

      <InfoAlert>{t('visaCharacterUploadBeforeSubmitAlert')}</InfoAlert>

      {/* ── Subsection: Other citizenships ────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaCharacterSubsectionOtherCitizenships')}</h3>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaCharacterHoldsOtherCitizenshipsLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.holdsOtherCitizenships}
          onChange={(v) => update('holdsOtherCitizenships', v)}
          ariaInvalid={errors.holdsOtherCitizenships}
        />
      </div>

      {form.holdsOtherCitizenships === true && (
        <div className="flex flex-col gap-4">
          {errors.otherCitizenshipsEmpty && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {t('visaCharacterCitizenshipsAtLeastOne')}
            </div>
          )}
          {otherCitizenships.map((row, idx) => (
            <div
              key={row.id}
              className="flex flex-col gap-3 rounded-xl border border-sorena-navy/10 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
                  {t('visaCharacterCitizenshipRowHeading', { n: idx + 1 })}
                </h4>
                <button
                  type="button"
                  onClick={() => handleRemoveCitizenship(row.id)}
                  title={t('visaCharacterCitizenshipRemoveTooltip')}
                  className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                  {t('visaCharacterCitizenshipCountryLabel')}<Asterisk />
                </label>
                <SearchableSelect
                  options={COUNTRIES}
                  value={row.country ?? ''}
                  onChange={(v) => handleCitizenshipCountry(row.id, v)}
                  placeholder={t('visaCommonCountryPlaceholder')}
                  hasError={!!errors[`citizenshipCountry:${row.id}`]}
                />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
                  {t('visaCharacterCitizenshipHoldsPassportLabel')}<Asterisk />
                </p>
                <YesNo
                  value={row.holdsPassport}
                  onChange={(v) => handleCitizenshipPassport(row.id, v)}
                  ariaInvalid={!!errors[`citizenshipPassport:${row.id}`]}
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={handleAddCitizenship}
            disabled={addingCitizenship}
            className="self-start rounded-lg border border-dashed border-sorena-navy/30 px-4 py-2 text-sm font-medium text-sorena-navy transition-colors hover:bg-sorena-navy/5 disabled:opacity-40"
          >
            + {t('visaCharacterCitizenshipAddButton')}
          </button>
        </div>
      )}

      {/* ── Subsection: Police certificates from other countries ─── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaCharacterSubsectionOtherCountries')}</h3>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaCharacterLivedOtherCountry5YearsLabel')}<Asterisk />
        </p>
        <p className="text-sm text-sorena-navy/60">{t('visaCharacterLivedOtherCountry5YearsHelper')}</p>
        <YesNo
          value={form.livedOtherCountry5Years}
          onChange={(v) => update('livedOtherCountry5Years', v)}
          ariaInvalid={errors.livedOtherCountry5Years}
        />
      </div>

      {/* Back + Save row */}
      <div className="flex items-center justify-between border-t border-sorena-navy/10 pt-4">
        <button
          type="button"
          onClick={() => setActiveStep(3)}
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
          {saving ? t('visaCommonSaving') : t('visaCharacterSaveButton')}
        </button>
      </div>
    </div>
  );
}
