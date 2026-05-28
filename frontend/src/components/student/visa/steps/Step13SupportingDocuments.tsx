'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useVisa } from '../VisaFormContext';
import { api } from '@/lib/api';
import {
  DocumentMetadataPicker,
  type DocumentMetadata,
  type DocumentType,
} from '../DocumentMetadataPicker';

// PR-VISA13 — INZ 1200 Section "Supporting documents" page 1.
// File storage is deferred to a later PR. The browser extracts
// originalFilename / mimeType / sizeBytes from the File object
// and PUTs only those primitives to /students/me/visa/
// supporting-documents/metadata. File bytes never reach the
// backend.
//
// Conditional sections:
//   * Military records — shown when visa.everUndertakenMilitaryService
//     (PR-VISA10 D2 gate) is true.
//   * Permission and Authority — shown when visa.completingOnBehalf
//     (PR-VISA12 gate) is true.

interface ServerPayload {
  livingInDifferentCountry: boolean | null;
  countryOfResidence: string | null;
  areAllDocsInEnglish: boolean | null;
  documents: DocumentMetadata[];
}

export function Step13SupportingDocuments() {
  const t = useTranslations();
  const { visa, setActiveStep, savedAt, setSavedAt } = useVisa();

  const [livingInDifferentCountry, setLivingInDifferentCountry] =
    useState<boolean | null>(null);
  const [countryOfResidence, setCountryOfResidence] = useState('');
  const [areAllDocsInEnglish, setAreAllDocsInEnglish] =
    useState<boolean | null>(null);
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);

  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Initial GET. Same lazy-load pattern as PR-12.
  useEffect(() => {
    let cancelled = false;
    api
      .get<ServerPayload>('/students/me/visa/supporting-documents')
      .then((data) => {
        if (cancelled) return;
        setLivingInDifferentCountry(data.livingInDifferentCountry);
        setCountryOfResidence(data.countryOfResidence ?? '');
        setAreAllDocsInEnglish(data.areAllDocsInEnglish);
        setDocuments(data.documents ?? []);
      })
      .catch(() => { /* leave defaults */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Conditional section flags derived from existing VisaApplication
  // gates. PR-VISA10 D2 = "have you ever undertaken military service
  // in any country"; PR-VISA12 = "completing on behalf of someone else".
  const showMilitary = visa.everUndertakenMilitaryService === true;
  const showAuthority = visa.completingOnBehalf === true;

  // Lookup helper for the picker rows — by documentType.
  const docMap = useMemo(() => {
    const m = new Map<DocumentType, DocumentMetadata>();
    for (const d of documents) m.set(d.documentType, d);
    return m;
  }, [documents]);

  const clearError = (key: string) =>
    setErrors((p) => ({ ...p, [key]: false }));

  // Picker callback — every upsert/delete returns the fresh server
  // payload so every picker stays in sync without a separate GET.
  const onPickerChange = (next: ServerPayload) => {
    setLivingInDifferentCountry(next.livingInDifferentCountry);
    setCountryOfResidence(next.countryOfResidence ?? '');
    setAreAllDocsInEnglish(next.areAllDocsInEnglish);
    setDocuments(next.documents ?? []);
  };

  const validate = (): string | null => {
    const e: Record<string, boolean> = {};
    let firstError: string | null = null;
    const flag = (key: string, ok: boolean, msg: string) => {
      if (!ok) { e[key] = true; if (!firstError) firstError = msg; }
    };
    flag(
      'areAllDocsInEnglish',
      areAllDocsInEnglish !== null,
      t('visaDocsErrorAreAllDocsInEnglishRequired'),
    );
    flag(
      'livingInDifferentCountry',
      livingInDifferentCountry !== null,
      t('visaDocsErrorLivingInDifferentCountryRequired'),
    );
    if (livingInDifferentCountry === true) {
      flag(
        'countryOfResidence',
        countryOfResidence.trim() !== '',
        t('visaDocsErrorCountryOfResidenceRequired'),
      );
      if (!docMap.has('RESIDENCE_VISA')) {
        e.residenceVisa = true;
        if (!firstError) firstError = t('visaDocsValidationResidenceVisaRequired');
      }
    }
    if (!docMap.has('PASSPORT')) {
      e.passport = true;
      if (!firstError) firstError = t('visaDocsValidationPassportRequired');
    }
    if (showMilitary && !docMap.has('MILITARY_RECORD')) {
      e.militaryRecord = true;
      if (!firstError) firstError = t('visaDocsValidationMilitaryRecordRequired');
    }
    if (showAuthority && !docMap.has('AUTHORITY_DOC')) {
      e.authorityDoc = true;
      if (!firstError) firstError = t('visaDocsValidationAuthorityDocRequired');
    }
    setErrors(e);
    return firstError;
  };

  const handleSave = async () => {
    setBannerError(null);
    const err = validate();
    if (err) {
      setBannerError(err);
      toast.error(t('visaDocsValidationMissing'));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        livingInDifferentCountry,
        countryOfResidence: livingInDifferentCountry === true
          ? countryOfResidence.trim()
          : null,
        areAllDocsInEnglish,
      };
      const next = await api.patch<ServerPayload>(
        '/students/me/visa/supporting-documents',
        payload,
      );
      setLivingInDifferentCountry(next.livingInDifferentCountry);
      setCountryOfResidence(next.countryOfResidence ?? '');
      setAreAllDocsInEnglish(next.areAllDocsInEnglish);
      setDocuments(next.documents ?? []);
      setSavedAt(new Date().toISOString());
      toast.success(t('visaDocsSaveSuccess'));
      // PR-VISA14: advance the stepper now that Section 14 exists.
      setActiveStep(14);
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : t('visaDocsSaveError');
      setBannerError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // ── Building blocks ───────────────────────────────────────────────

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

  const inputClass = (hasError: boolean) =>
    [
      'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');

  if (!loaded) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-sorena-navy/50">
        {t('visaDocsLoading')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-sorena-navy">{t('visaDocsSectionTitle')}</h2>
      <p className="text-sm text-sorena-navy/70">{t('visaDocsIntro')}</p>

      {savedAt && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('visaDocsSavedBanner')}
        </div>
      )}
      {bannerError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {bannerError}
        </div>
      )}

      {/* Guidance */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocsSectionGuidance')}</h3>
      </div>
      <p className="text-sm text-sorena-navy/70">{t('visaDocsGuidanceBody')}</p>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaDocsAreAllDocsInEnglishLabel')}<Asterisk />
        </p>
        <YesNo
          value={areAllDocsInEnglish}
          onChange={(v) => { setAreAllDocsInEnglish(v); clearError('areAllDocsInEnglish'); }}
          ariaInvalid={!!errors.areAllDocsInEnglish}
        />
      </div>

      {/* Identity evidence */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocsSectionIdentityEvidence')}</h3>
      </div>

      <DocumentMetadataPicker
        documentType="PASSPORT"
        label={t('visaDocsDocPassport')}
        required
        helpText={t('visaDocsDocPassportHelp')}
        metadata={docMap.get('PASSPORT') ?? null}
        onChange={onPickerChange}
        ariaInvalid={!!errors.passport}
      />
      <DocumentMetadataPicker
        documentType="NATIONAL_ID"
        label={t('visaDocsDocNationalId')}
        helpText={t('visaDocsDocNationalIdHelp')}
        metadata={docMap.get('NATIONAL_ID') ?? null}
        onChange={onPickerChange}
      />

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaDocsLivingInDifferentCountryLabel')}<Asterisk />
        </p>
        <YesNo
          value={livingInDifferentCountry}
          onChange={(v) => {
            setLivingInDifferentCountry(v);
            clearError('livingInDifferentCountry');
            if (v === false) {
              // Mirror server clearing: country + RESIDENCE_VISA row
              // clear on save; locally wipe the country field so the
              // UI doesn't flash stale data before save.
              setCountryOfResidence('');
            }
          }}
          ariaInvalid={!!errors.livingInDifferentCountry}
        />
      </div>

      {livingInDifferentCountry === true && (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaDocsCountryOfResidenceLabel')}<Asterisk />
            </label>
            <input
              type="text"
              value={countryOfResidence}
              onChange={(e) => {
                setCountryOfResidence(e.target.value);
                clearError('countryOfResidence');
              }}
              className={inputClass(!!errors.countryOfResidence)}
            />
          </div>
          <DocumentMetadataPicker
            documentType="RESIDENCE_VISA"
            label={t('visaDocsDocResidenceVisa')}
            required
            helpText={t('visaDocsDocResidenceVisaHelp')}
            metadata={docMap.get('RESIDENCE_VISA') ?? null}
            onChange={onPickerChange}
            ariaInvalid={!!errors.residenceVisa}
          />
        </>
      )}

      {/* Military records */}
      {showMilitary && (
        <>
          <div className="mt-2 border-t border-sorena-navy/10 pt-6">
            <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocsSectionMilitaryRecords')}</h3>
          </div>
          <DocumentMetadataPicker
            documentType="MILITARY_RECORD"
            label={t('visaDocsDocMilitaryRecord')}
            required
            metadata={docMap.get('MILITARY_RECORD') ?? null}
            onChange={onPickerChange}
            ariaInvalid={!!errors.militaryRecord}
          />
        </>
      )}

      {/* Travel history (always shown, always optional) */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocsSectionTravelHistory')}</h3>
      </div>
      <DocumentMetadataPicker
        documentType="TRAVEL_HISTORY"
        label={t('visaDocsDocTravelHistory')}
        helpText={t('visaDocsDocTravelHistoryHelp')}
        metadata={docMap.get('TRAVEL_HISTORY') ?? null}
        onChange={onPickerChange}
      />

      {/* Permission and Authority (conditional) */}
      {showAuthority && (
        <>
          <div className="mt-2 border-t border-sorena-navy/10 pt-6">
            <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocsSectionPermissionAuthority')}</h3>
          </div>
          <DocumentMetadataPicker
            documentType="AUTHORITY_DOC"
            label={t('visaDocsDocAuthority')}
            required
            helpText={t('visaDocsDocAuthorityHelp')}
            metadata={docMap.get('AUTHORITY_DOC') ?? null}
            onChange={onPickerChange}
            ariaInvalid={!!errors.authorityDoc}
          />
        </>
      )}

      {/* Back + Save row */}
      <div className="flex items-center justify-between border-t border-sorena-navy/10 pt-4">
        <button
          type="button"
          onClick={() => setActiveStep(12)}
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
          {saving ? t('visaCommonSaving') : t('visaDocsSaveButton')}
        </button>
      </div>
    </div>
  );
}
