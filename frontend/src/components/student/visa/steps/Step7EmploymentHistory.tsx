'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import {
  useVisa,
  type EmploymentEntry,
  type EmploymentEntryPatch,
  type UnemploymentEntry,
  type UnemploymentEntryPatch,
} from '../VisaFormContext';
import { COUNTRIES } from '@/lib/data/countries';
import { SearchableSelect } from '@/components/common/SearchableSelect';

// PR-VISA7 — INZ 1200 Section 7 "Employment history".
// Three repeating sub-blocks share the same draft-then-fill, live-API
// pattern as the citizenship / TB rows. Free-text duties / activity /
// financial-support persist encrypted; everything else plaintext.
// Date inputs are <input type="month"> for month + year precision —
// browser handles localisation. The string the server receives is
// "YYYY-MM"; we convert to ISO datetime via Date.UTC.

function isoToMonthInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
function monthInputToIso(value: string): string | null {
  if (!value) return null;
  const [y, m] = value.split('-').map((s) => parseInt(s, 10));
  if (!Number.isInteger(y) || !Number.isInteger(m)) return null;
  return new Date(Date.UTC(y, m - 1, 1)).toISOString();
}

export function Step7EmploymentHistory() {
  const t = useTranslations();
  const {
    visa,
    patchVisa,
    setActiveStep,
    savedAt,
    setSavedAt,
    employmentEntries,
    addEmploymentEntry,
    updateEmploymentEntry,
    deleteEmploymentEntry,
    unemploymentEntries,
    addUnemploymentEntry,
    updateUnemploymentEntry,
    deleteUnemploymentEntry,
  } = useVisa();

  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [addingPrev, setAddingPrev] = useState(false);
  const [addingUnemp, setAddingUnemp] = useState(false);

  // Local-state buffers for text inputs so we PATCH on blur, not on every
  // keystroke. Keyed by `${rowId}.${field}`.
  const [textBuf, setTextBuf] = useState<Record<string, string>>({});
  const getBuf = (rowId: string, field: string, fallback: string) =>
    textBuf[`${rowId}.${field}`] ?? fallback;
  const setBuf = (rowId: string, field: string, value: string) =>
    setTextBuf((prev) => ({ ...prev, [`${rowId}.${field}`]: value }));

  // Three top-level Y/Ns live in context.visa.* and persist on Save.
  const [topYN, setTopYN] = useState({
    everGovernmentEmployed: visa.everGovernmentEmployed,
    everPrisonGuard:        visa.everPrisonGuard,
    currentlyWorking:       visa.currentlyWorking,
    hadPreviousEmployment:  visa.hadPreviousEmployment,
    everUnemployed:         visa.everUnemployed,
  });
  const updateTop = <K extends keyof typeof topYN>(k: K, v: boolean) => {
    setTopYN((prev) => ({ ...prev, [k]: v }));
    if (errors[k as string]) setErrors((prev) => ({ ...prev, [k as string]: false }));
  };

  // Auto-create the singleton CURRENT row when the student toggles
  // currentlyWorking=Yes and no CURRENT row exists yet. useRef guards
  // against the effect firing twice in StrictMode.
  const currentEntry = employmentEntries.find(e => e.entryKind === 'CURRENT') ?? null;
  const previousEntries = employmentEntries.filter(e => e.entryKind === 'PREVIOUS');
  const autoCreatedRef = useRef(false);
  useEffect(() => {
    if (topYN.currentlyWorking !== true) return;
    if (currentEntry) return;
    if (autoCreatedRef.current) return;
    autoCreatedRef.current = true;
    addEmploymentEntry('CURRENT').catch(() => {
      autoCreatedRef.current = false;
      toast.error(t('visaEmploymentAddError'));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topYN.currentlyWorking, currentEntry]);

  // Reset the guard when toggled back to No so a future Yes triggers create.
  useEffect(() => {
    if (topYN.currentlyWorking !== true) autoCreatedRef.current = false;
  }, [topYN.currentlyWorking]);

  // ── Per-row handlers ──────────────────────────────────────────────

  const clearErr = (key: string) => {
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: false }));
  };

  const patchEmpField = async (rowId: string, patch: EmploymentEntryPatch, errKey?: string) => {
    if (errKey) clearErr(errKey);
    try {
      await updateEmploymentEntry(rowId, patch);
    } catch {
      toast.error(t('visaEmploymentUpdateError'));
    }
  };

  const patchUnempField = async (rowId: string, patch: UnemploymentEntryPatch, errKey?: string) => {
    if (errKey) clearErr(errKey);
    try {
      await updateUnemploymentEntry(rowId, patch);
    } catch {
      toast.error(t('visaEmploymentUpdateError'));
    }
  };

  const handleAddPrevious = async () => {
    if (addingPrev) return;
    setAddingPrev(true);
    try {
      await addEmploymentEntry('PREVIOUS');
    } catch {
      toast.error(t('visaEmploymentAddError'));
    } finally {
      setAddingPrev(false);
    }
  };

  const handleRemoveEmployment = async (rowId: string) => {
    if (!window.confirm(t('visaEmploymentRemoveConfirm'))) return;
    try {
      await deleteEmploymentEntry(rowId);
    } catch {
      toast.error(t('visaEmploymentRemoveError'));
    }
  };

  const handleAddUnemployment = async () => {
    if (addingUnemp) return;
    setAddingUnemp(true);
    try {
      await addUnemploymentEntry();
    } catch {
      toast.error(t('visaUnempAddError'));
    } finally {
      setAddingUnemp(false);
    }
  };

  const handleRemoveUnemployment = async (rowId: string) => {
    if (!window.confirm(t('visaUnempRemoveConfirm'))) return;
    try {
      await deleteUnemploymentEntry(rowId);
    } catch {
      toast.error(t('visaUnempRemoveError'));
    }
  };

  // ── Save validator ────────────────────────────────────────────────

  const validateEmployment = (
    row: EmploymentEntry,
    kind: 'CURRENT' | 'PREVIOUS',
    e: Record<string, boolean>,
    missing: string[],
  ) => {
    const flag = (k: string, ok: boolean) => {
      if (!ok) { e[`${k}:${row.id}`] = true; missing.push(`${k}:${row.id}`); }
    };
    flag('startDate', !!row.startDate);
    if (kind === 'PREVIOUS') flag('endDate', !!row.endDate);
    flag('roleTitle', !!row.roleTitle?.trim());
    flag('duties', !!row.duties?.trim());
    flag('countryOfWork', !!row.countryOfWork?.trim());
    flag('stateOfWork', !!row.stateOfWork?.trim());
    flag('supervisorName', !!row.supervisorName?.trim());
    flag('organisationField', !!row.organisationField?.trim());
    flag('organisationCountry', !!row.organisationCountry?.trim());
    flag('organisationState', !!row.organisationState?.trim());
    flag('employerName', !!row.employerName?.trim());
    flag('employerStreet', !!row.employerStreet?.trim());
    flag('employerTownCity', !!row.employerTownCity?.trim());
    flag('employerPhone', !!row.employerPhone?.trim());
    flag('employerEmail', !!row.employerEmail?.trim());
  };

  const validate = (): string[] => {
    const missing: string[] = [];
    const e: Record<string, boolean> = {};

    for (const k of [
      'everGovernmentEmployed',
      'everPrisonGuard',
      'currentlyWorking',
      'hadPreviousEmployment',
      'everUnemployed',
    ] as const) {
      if (topYN[k] === null) { e[k] = true; missing.push(k); }
    }

    if (topYN.currentlyWorking === true) {
      if (!currentEntry) {
        e.currentEntryMissing = true; missing.push('currentEntryMissing');
      } else {
        validateEmployment(currentEntry, 'CURRENT', e, missing);
      }
    }
    if (topYN.hadPreviousEmployment === true) {
      if (previousEntries.length === 0) {
        e.previousEmpty = true; missing.push('previousEmpty');
      } else {
        for (const row of previousEntries) validateEmployment(row, 'PREVIOUS', e, missing);
      }
    }
    if (topYN.everUnemployed === true) {
      if (unemploymentEntries.length === 0) {
        e.unemploymentEmpty = true; missing.push('unemploymentEmpty');
      } else {
        for (const row of unemploymentEntries) {
          const flag = (k: string, ok: boolean) => {
            if (!ok) { e[`${k}:${row.id}`] = true; missing.push(`${k}:${row.id}`); }
          };
          flag('unempStart', !!row.startDate);
          flag('unempEnd', !!row.endDate);
          flag('unempActivity', !!row.activity?.trim());
          flag('unempFinSupport', !!row.financialSupport?.trim());
        }
      }
    }

    setErrors(e);
    return missing;
  };

  const handleSave = async () => {
    const missing = validate();
    if (missing.length > 0) {
      toast.error(t('visaEmploymentValidationMissing'));
      return;
    }
    setSaving(true);
    try {
      await patchVisa({
        everGovernmentEmployed: topYN.everGovernmentEmployed,
        everPrisonGuard:        topYN.everPrisonGuard,
        currentlyWorking:       topYN.currentlyWorking,
        hadPreviousEmployment:  topYN.hadPreviousEmployment,
        everUnemployed:         topYN.everUnemployed,
        currentStep:            8,
      });
      setSavedAt(new Date().toISOString());
      toast.success(t('visaEmploymentSaveSuccess'));
    } catch {
      toast.error(t('visaEmploymentSaveError'));
    } finally {
      setSaving(false);
    }
  };

  // ── UI building blocks ────────────────────────────────────────────

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

  // ── Per-job render (CURRENT + PREVIOUS) ───────────────────────────

  const renderJobBlock = (
    row: EmploymentEntry,
    kind: 'CURRENT' | 'PREVIOUS',
    idx?: number,
  ) => {
    const k = (field: string) => `${field}:${row.id}`;
    const textField = (
      field: keyof EmploymentEntryPatch,
      label: string,
      asterisk = true,
    ) => {
      const errKey = k(field as string);
      return (
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {label}{asterisk && <Asterisk />}
          </label>
          <input
            type="text"
            value={getBuf(row.id, field as string, (row[field as keyof EmploymentEntry] as string | null) ?? '')}
            onChange={(e) => setBuf(row.id, field as string, e.target.value)}
            onBlur={(e) => patchEmpField(row.id, { [field]: e.target.value.trim() || null }, errKey)}
            className={inputClass(!!errors[errKey])}
          />
        </div>
      );
    };

    return (
      <div
        key={row.id}
        className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
            {kind === 'CURRENT'
              ? t('visaEmploymentCurrentHeading')
              : t('visaEmploymentPreviousHeading', { n: (idx ?? 0) + 1 })}
          </h4>
          {kind === 'PREVIOUS' && (
            <button
              type="button"
              onClick={() => handleRemoveEmployment(row.id)}
              title={t('visaEmploymentRemoveTooltip')}
              className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>

        {/* Start (+ End for PREVIOUS) — month + year compact */}
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaEmploymentStartDateLabel')}<Asterisk />
            </label>
            <input
              type="month"
              value={isoToMonthInput(row.startDate)}
              onChange={(e) =>
                patchEmpField(row.id, { startDate: monthInputToIso(e.target.value) }, k('startDate'))
              }
              className={dateInputClass(!!errors[k('startDate')])}
            />
          </div>
          {kind === 'PREVIOUS' && (
            <div>
              <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                {t('visaEmploymentEndDateLabel')}<Asterisk />
              </label>
              <input
                type="month"
                value={isoToMonthInput(row.endDate)}
                onChange={(e) =>
                  patchEmpField(row.id, { endDate: monthInputToIso(e.target.value) }, k('endDate'))
                }
                className={dateInputClass(!!errors[k('endDate')])}
              />
            </div>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaEmploymentRoleTitleLabel')}<Asterisk />
          </label>
          <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaEmploymentRoleTitleHelper')}</p>
          <input
            type="text"
            value={getBuf(row.id, 'roleTitle', row.roleTitle ?? '')}
            onChange={(e) => setBuf(row.id, 'roleTitle', e.target.value)}
            onBlur={(e) => patchEmpField(row.id, { roleTitle: e.target.value.trim() || null }, k('roleTitle'))}
            className={inputClass(!!errors[k('roleTitle')])}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaEmploymentDutiesLabel')}<Asterisk />
          </label>
          <textarea
            rows={4}
            value={getBuf(row.id, 'duties', row.duties ?? '')}
            onChange={(e) => setBuf(row.id, 'duties', e.target.value)}
            onBlur={(e) => patchEmpField(row.id, { duties: e.target.value.trim() || null }, k('duties'))}
            className={inputClass(!!errors[k('duties')])}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaEmploymentCountryOfWorkLabel')}<Asterisk />
          </label>
          <SearchableSelect
            options={COUNTRIES}
            value={row.countryOfWork ?? ''}
            onChange={(v) => patchEmpField(row.id, { countryOfWork: v }, k('countryOfWork'))}
            placeholder={t('visaCommonCountryPlaceholder')}
            hasError={!!errors[k('countryOfWork')]}
          />
        </div>

        {textField('stateOfWork', t('visaEmploymentStateOfWorkLabel'))}
        {textField('supervisorName', t('visaEmploymentSupervisorLabel'))}
        {textField('organisationField', t('visaEmploymentOrgFieldLabel'))}

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaEmploymentOrgCountryLabel')}<Asterisk />
          </label>
          <SearchableSelect
            options={COUNTRIES}
            value={row.organisationCountry ?? ''}
            onChange={(v) => patchEmpField(row.id, { organisationCountry: v }, k('organisationCountry'))}
            placeholder={t('visaCommonCountryPlaceholder')}
            hasError={!!errors[k('organisationCountry')]}
          />
        </div>

        {textField('organisationState', t('visaEmploymentOrgStateLabel'))}

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaEmploymentEmployerNameLabel')}<Asterisk />
          </label>
          <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaEmploymentEmployerNameHelper')}</p>
          <input
            type="text"
            value={getBuf(row.id, 'employerName', row.employerName ?? '')}
            onChange={(e) => setBuf(row.id, 'employerName', e.target.value)}
            onBlur={(e) => patchEmpField(row.id, { employerName: e.target.value.trim() || null }, k('employerName'))}
            className={inputClass(!!errors[k('employerName')])}
          />
        </div>

        <p className="text-sm font-bold text-sorena-navy">{t('visaEmploymentHeadOfficeHeading')}</p>
        {textField('employerStreet', t('visaEmploymentStreetLabel'))}
        {textField('employerSuburb', t('visaEmploymentSuburbLabel'), false)}
        {textField('employerTownCity', t('visaEmploymentTownCityLabel'))}
        {textField('employerSubregion', t('visaEmploymentSubregionLabel'), false)}
        {textField('employerRegion', t('visaEmploymentRegionLabel'), false)}
        {textField('employerPostcode', t('visaEmploymentPostcodeLabel'), false)}

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaEmploymentEmployerPhoneLabel')}<Asterisk />
          </label>
          <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaEmploymentEmployerPhoneHelper')}</p>
          <input
            type="text"
            value={getBuf(row.id, 'employerPhone', row.employerPhone ?? '')}
            onChange={(e) => setBuf(row.id, 'employerPhone', e.target.value)}
            onBlur={(e) => patchEmpField(row.id, { employerPhone: e.target.value.trim() || null }, k('employerPhone'))}
            className={inputClass(!!errors[k('employerPhone')])}
          />
        </div>

        {textField('employerEmail', t('visaEmploymentEmployerEmailLabel'))}
      </div>
    );
  };

  // ── Unemployment row render ───────────────────────────────────────

  const renderUnempBlock = (row: UnemploymentEntry, idx: number) => {
    const k = (field: string) => `${field}:${row.id}`;
    return (
      <div
        key={row.id}
        className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
            {t('visaUnempRowHeading', { n: idx + 1 })}
          </h4>
          <button
            type="button"
            onClick={() => handleRemoveUnemployment(row.id)}
            title={t('visaUnempRemoveTooltip')}
            className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 size={16} />
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-6">
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaUnempStartDateLabel')}<Asterisk />
            </label>
            <input
              type="month"
              value={isoToMonthInput(row.startDate)}
              onChange={(e) =>
                patchUnempField(row.id, { startDate: monthInputToIso(e.target.value) }, k('unempStart'))
              }
              className={dateInputClass(!!errors[k('unempStart')])}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaUnempEndDateLabel')}<Asterisk />
            </label>
            <input
              type="month"
              value={isoToMonthInput(row.endDate)}
              onChange={(e) =>
                patchUnempField(row.id, { endDate: monthInputToIso(e.target.value) }, k('unempEnd'))
              }
              className={dateInputClass(!!errors[k('unempEnd')])}
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaUnempActivityLabel')}<Asterisk />
          </label>
          <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaUnempActivityHelper')}</p>
          <textarea
            rows={4}
            value={getBuf(row.id, 'activity', row.activity ?? '')}
            onChange={(e) => setBuf(row.id, 'activity', e.target.value)}
            onBlur={(e) => patchUnempField(row.id, { activity: e.target.value.trim() || null }, k('unempActivity'))}
            className={inputClass(!!errors[k('unempActivity')])}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaUnempFinSupportLabel')}<Asterisk />
          </label>
          <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaUnempFinSupportHelper')}</p>
          <textarea
            rows={4}
            value={getBuf(row.id, 'financialSupport', row.financialSupport ?? '')}
            onChange={(e) => setBuf(row.id, 'financialSupport', e.target.value)}
            onBlur={(e) => patchUnempField(row.id, { financialSupport: e.target.value.trim() || null }, k('unempFinSupport'))}
            className={inputClass(!!errors[k('unempFinSupport')])}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-sorena-navy">{t('visaEmploymentHistorySectionTitle')}</h2>
      <p className="text-sm text-sorena-navy/70">{t('visaEmploymentHistoryIntro')}</p>

      <InfoAlert>{t('visaEmploymentContinuousHistoryAlert')}</InfoAlert>

      {savedAt && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('visaEmploymentSavedBanner')}
        </div>
      )}

      {/* ── Employment history (screening Y/Ns) ───────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaEmploymentSubsectionHistory')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEmploymentEverGovernmentLabel')}<Asterisk />
        </p>
        <p className="text-sm text-sorena-navy/60">{t('visaEmploymentEverGovernmentHelper')}</p>
        <YesNo
          value={topYN.everGovernmentEmployed}
          onChange={(v) => updateTop('everGovernmentEmployed', v)}
          ariaInvalid={errors.everGovernmentEmployed}
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEmploymentEverPrisonGuardLabel')}<Asterisk />
        </p>
        <YesNo
          value={topYN.everPrisonGuard}
          onChange={(v) => updateTop('everPrisonGuard', v)}
          ariaInvalid={errors.everPrisonGuard}
        />
      </div>

      {/* ── Current employment ────────────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaEmploymentSubsectionCurrent')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEmploymentCurrentlyWorkingLabel')}<Asterisk />
        </p>
        <p className="text-sm text-sorena-navy/60">{t('visaEmploymentCurrentlyWorkingHelper')}</p>
        <YesNo
          value={topYN.currentlyWorking}
          onChange={(v) => updateTop('currentlyWorking', v)}
          ariaInvalid={errors.currentlyWorking}
        />
      </div>
      {topYN.currentlyWorking === true && (
        <>
          <p className="text-sm font-bold text-sorena-navy">{t('visaEmploymentProvideCurrentDetails')}</p>
          {currentEntry
            ? renderJobBlock(currentEntry, 'CURRENT')
            : <p className="text-sm text-sorena-navy/60">{t('visaEmploymentCurrentLoading')}</p>}
        </>
      )}

      {/* ── Previous employment ───────────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaEmploymentSubsectionPrevious')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEmploymentHadPreviousLabel')}<Asterisk />
        </p>
        <YesNo
          value={topYN.hadPreviousEmployment}
          onChange={(v) => updateTop('hadPreviousEmployment', v)}
          ariaInvalid={errors.hadPreviousEmployment}
        />
      </div>
      {topYN.hadPreviousEmployment === true && (
        <>
          <p className="text-sm font-bold text-sorena-navy">{t('visaEmploymentProvidePreviousDetails')}</p>
          {errors.previousEmpty && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {t('visaEmploymentPreviousAtLeastOne')}
            </div>
          )}
          {previousEntries.map((row, idx) => renderJobBlock(row, 'PREVIOUS', idx))}
          <button
            type="button"
            onClick={handleAddPrevious}
            disabled={addingPrev}
            className="self-start rounded-lg border border-dashed border-sorena-navy/30 px-4 py-2 text-sm font-medium text-sorena-navy transition-colors hover:bg-sorena-navy/5 disabled:opacity-40"
          >
            + {t('visaEmploymentAddPreviousButton')}
          </button>
        </>
      )}

      {/* ── Unemployment / unpaid ─────────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaEmploymentSubsectionUnemployed')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEmploymentEverUnemployedLabel')}<Asterisk />
        </p>
        <p className="text-sm text-sorena-navy/60">{t('visaEmploymentEverUnemployedHelper')}</p>
        <YesNo
          value={topYN.everUnemployed}
          onChange={(v) => updateTop('everUnemployed', v)}
          ariaInvalid={errors.everUnemployed}
        />
      </div>
      {topYN.everUnemployed === true && (
        <>
          <p className="text-sm font-bold text-sorena-navy">{t('visaUnempProvideDetails')}</p>
          {errors.unemploymentEmpty && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {t('visaUnempAtLeastOne')}
            </div>
          )}
          {unemploymentEntries.map((row, idx) => renderUnempBlock(row, idx))}
          <button
            type="button"
            onClick={handleAddUnemployment}
            disabled={addingUnemp}
            className="self-start rounded-lg border border-dashed border-sorena-navy/30 px-4 py-2 text-sm font-medium text-sorena-navy transition-colors hover:bg-sorena-navy/5 disabled:opacity-40"
          >
            + {t('visaUnempAddButton')}
          </button>
        </>
      )}

      {/* Back + Save row */}
      <div className="flex items-center justify-between border-t border-sorena-navy/10 pt-4">
        <button
          type="button"
          onClick={() => setActiveStep(6)}
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
          {saving ? t('visaCommonSaving') : t('visaEmploymentSaveButton')}
        </button>
      </div>
    </div>
  );
}
