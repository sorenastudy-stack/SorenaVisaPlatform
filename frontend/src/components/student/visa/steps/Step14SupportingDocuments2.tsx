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
import {
  OtherEvidenceCard,
  OtherEvidenceAdder,
  type OtherEvidenceEntry,
} from '../OtherEvidenceCard';

// PR-VISA14 — INZ 1200 Section "Supporting documents page 2".
// Final Visa Section step. File storage still deferred — every
// picker writes only metadata via PR-13's endpoint or the new
// other-evidence endpoint. The server applies cascade-clear rules
// on save so the local clearing in this component is purely UX.

type TuitionPaymentMethod =
  | 'SELF_PAID' | 'PARTNER_PROVIDER_OR_GOVT_LOAN'
  | 'THIRD_PARTY_SPONSOR' | 'SCHOLARSHIP';

const TUITION_METHODS: TuitionPaymentMethod[] = [
  'SELF_PAID', 'PARTNER_PROVIDER_OR_GOVT_LOAN',
  'THIRD_PARTY_SPONSOR', 'SCHOLARSHIP',
];

interface ServerPayload {
  tuitionFeesPaid: boolean | null;
  tuitionPaymentMethod: TuitionPaymentMethod | null;
  fundsSourceSavings: boolean | null;
  fundsSourceNZSponsor: boolean | null;
  fundsSourceInz1014: boolean | null;
  fundsSourcePrepaidAccom: boolean | null;
  fundsSourceScholarship: boolean | null;
  outwardSourceSufficientFunds: boolean | null;
  outwardSourceInz1014: boolean | null;
  outwardSourcePrepaidBooking: boolean | null;
  outwardSourceScholarship: boolean | null;
  fundsFormatBankAccount: boolean | null;
  fundsFormatProvidentFund: boolean | null;
  fundsFormatEducationLoan: boolean | null;
  fundsFormatFixedTermDeposit: boolean | null;
  fundsFormatOther: boolean | null;
  savingsSourceWages: boolean | null;
  savingsSourceSelfEmployment: boolean | null;
  savingsSourceRentalIncome: boolean | null;
  savingsSourceOther: boolean | null;
  depositExplanation: string | null;
  scholarshipName: string | null;
  scholarshipOrganisation: string | null;
  studyIs120CreditsOrMore: boolean | null;
  courseRequiresPracticalWork: boolean | null;
  tookEnglishTest: boolean | null;
  declarationChecked: boolean | null;
  otherEvidence: OtherEvidenceEntry[];
}

// Picker payload also returns documents; we only need to refresh
// docMap on the parent step. We use a separate GET for the
// supporting-documents (page 1) metadata array since the new
// document types route through PR-13's existing endpoint.
interface PickerServerPayload {
  livingInDifferentCountry: boolean | null;
  countryOfResidence: string | null;
  areAllDocsInEnglish: boolean | null;
  documents: DocumentMetadata[];
}

export function Step14SupportingDocuments2() {
  const t = useTranslations();
  const {
    visa, setActiveStep, savedAt, setSavedAt,
    employmentEntries, educationEntries,
  } = useVisa();

  // Parent flags
  const [s, setS] = useState<ServerPayload | null>(null);
  // Document metadata (PR-13 table — shared between page 1 and page 2)
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);

  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Local mirrors of the encrypted free-text fields — kept separate
  // from `s` because the user can type freely and we only push on
  // save (the server already has the decrypted plaintext on GET).
  const [depositExplanation, setDepositExplanation] = useState('');
  const [scholarshipName, setScholarshipName] = useState('');
  const [scholarshipOrganisation, setScholarshipOrganisation] = useState('');

  // Initial GET — two parallel requests for the page-2 payload and
  // the shared metadata table.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<ServerPayload>('/students/me/visa/supporting-documents-2'),
      api.get<PickerServerPayload>('/students/me/visa/supporting-documents'),
    ])
      .then(([page2, page1]) => {
        if (cancelled) return;
        setS(page2);
        setDepositExplanation(page2.depositExplanation ?? '');
        setScholarshipName(page2.scholarshipName ?? '');
        setScholarshipOrganisation(page2.scholarshipOrganisation ?? '');
        setDocuments(page1.documents ?? []);
      })
      .catch(() => { /* leave defaults */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Conditional section flags from existing PR-3/6/7/10/12 data.
  const isPhd = visa.studyingMastersOrPhd === 'PHD';
  const hasPublications = visa.phdPublishedPapers === true;
  const hasEducationEntries = educationEntries.length > 0;
  const isCurrentlyEmployed = employmentEntries.some((e) => e.entryKind === 'CURRENT');
  const hasPreviousEmployment = employmentEntries.some((e) => e.entryKind === 'PREVIOUS');

  const docMap = useMemo(() => {
    const m = new Map<DocumentType, DocumentMetadata>();
    for (const d of documents) m.set(d.documentType, d);
    return m;
  }, [documents]);

  // Helpers to mutate the parent payload.
  const set = (patch: Partial<ServerPayload>) => {
    setS((prev) => (prev ? { ...prev, ...patch } : prev));
  };
  const clearError = (key: string) =>
    setErrors((p) => ({ ...p, [key]: false }));

  // Picker callback — PR-13 endpoint returns the page-1 payload
  // (parent fields + documents). We only need to refresh the
  // documents array here.
  const onPickerChange = (next: PickerServerPayload) => {
    setDocuments(next.documents ?? []);
  };

  // Other-evidence picker callback — refreshes the page-2 payload.
  const onOtherEvidenceChange = (next: ServerPayload) => {
    setS(next);
    setDepositExplanation(next.depositExplanation ?? depositExplanation);
    setScholarshipName(next.scholarshipName ?? scholarshipName);
    setScholarshipOrganisation(next.scholarshipOrganisation ?? scholarshipOrganisation);
  };

  // Derived gates from `s` (with guards for the loading state).
  const tuitionFeesPaid = s?.tuitionFeesPaid ?? null;
  const tuitionPaymentMethod = s?.tuitionPaymentMethod ?? null;

  const fundsSource = {
    Savings:        s?.fundsSourceSavings        ?? null,
    NZSponsor:      s?.fundsSourceNZSponsor      ?? null,
    Inz1014:        s?.fundsSourceInz1014        ?? null,
    PrepaidAccom:   s?.fundsSourcePrepaidAccom   ?? null,
    Scholarship:    s?.fundsSourceScholarship    ?? null,
  };
  const outwardSource = {
    SufficientFunds: s?.outwardSourceSufficientFunds ?? null,
    Inz1014:         s?.outwardSourceInz1014         ?? null,
    PrepaidBooking:  s?.outwardSourcePrepaidBooking  ?? null,
    Scholarship:     s?.outwardSourceScholarship     ?? null,
  };
  const fundsFormat = {
    BankAccount:      s?.fundsFormatBankAccount      ?? null,
    ProvidentFund:    s?.fundsFormatProvidentFund    ?? null,
    EducationLoan:    s?.fundsFormatEducationLoan    ?? null,
    FixedTermDeposit: s?.fundsFormatFixedTermDeposit ?? null,
    Other:            s?.fundsFormatOther            ?? null,
  };
  const savingsSource = {
    Wages:          s?.savingsSourceWages          ?? null,
    SelfEmployment: s?.savingsSourceSelfEmployment ?? null,
    RentalIncome:   s?.savingsSourceRentalIncome   ?? null,
    Other:          s?.savingsSourceOther          ?? null,
  };

  const showFundsFormat = fundsSource.Savings === true;
  const showSavingsSources = showFundsFormat && fundsFormat.BankAccount === true;
  const requireEmploymentIncomeEvidence =
    showSavingsSources && (savingsSource.Wages === true || savingsSource.SelfEmployment === true);
  const requireInz1014 = fundsSource.Inz1014 === true || outwardSource.Inz1014 === true;
  const requirePrepaidAccom = fundsSource.PrepaidAccom === true;
  const requireOutwardTravelDoc = outwardSource.PrepaidBooking === true;
  const scholarshipActive =
    fundsSource.Scholarship === true ||
    outwardSource.Scholarship === true ||
    tuitionPaymentMethod === 'SCHOLARSHIP';
  const requireTuitionPaymentConfirmation =
    tuitionFeesPaid === true ||
    tuitionPaymentMethod === 'PARTNER_PROVIDER_OR_GOVT_LOAN' ||
    tuitionPaymentMethod === 'THIRD_PARTY_SPONSOR' ||
    tuitionPaymentMethod === 'SCHOLARSHIP';

  const atLeastOneFundsSource = Object.values(fundsSource).some((v) => v === true);
  const atLeastOneOutwardSource = Object.values(outwardSource).some((v) => v === true);
  const atLeastOneFundsFormat = Object.values(fundsFormat).some((v) => v === true);
  const atLeastOneSavingsSource = Object.values(savingsSource).some((v) => v === true);

  const validate = (): string | null => {
    const e: Record<string, boolean> = {};
    let first: string | null = null;
    const flag = (key: string, ok: boolean, msg: string) => {
      if (!ok) { e[key] = true; if (!first) first = msg; }
    };

    // Required docs (always)
    if (!docMap.has('OFFER_OF_PLACE')) {
      e.OFFER_OF_PLACE = true;
      if (!first) first = t('visaDocs2ValidationDocRequired');
    }
    if (!docMap.has('PERSONAL_CIRCUMSTANCES_EVIDENCE')) {
      e.PERSONAL_CIRCUMSTANCES_EVIDENCE = true;
      if (!first) first = t('visaDocs2ValidationDocRequired');
    }
    // Conditional doc requireds
    if (isPhd && !docMap.has('PHD_RESEARCH_PROPOSAL')) {
      e.PHD_RESEARCH_PROPOSAL = true; if (!first) first = t('visaDocs2ValidationDocRequired');
    }
    if (hasPublications && !docMap.has('PUBLICATIONS_LIST')) {
      e.PUBLICATIONS_LIST = true; if (!first) first = t('visaDocs2ValidationDocRequired');
    }
    if (hasEducationEntries && !docMap.has('PREVIOUS_TERTIARY_EVIDENCE')) {
      e.PREVIOUS_TERTIARY_EVIDENCE = true; if (!first) first = t('visaDocs2ValidationDocRequired');
    }
    if (isCurrentlyEmployed && !docMap.has('CURRENT_EMPLOYMENT_EVIDENCE')) {
      e.CURRENT_EMPLOYMENT_EVIDENCE = true; if (!first) first = t('visaDocs2ValidationDocRequired');
    }
    if (hasPreviousEmployment && !docMap.has('PREVIOUS_EMPLOYMENT_EVIDENCE')) {
      e.PREVIOUS_EMPLOYMENT_EVIDENCE = true; if (!first) first = t('visaDocs2ValidationDocRequired');
    }

    flag('tookEnglishTest', s?.tookEnglishTest !== null && s?.tookEnglishTest !== undefined, t('visaDocs2ValidationRequired'));
    if (s?.tookEnglishTest === true && !docMap.has('ENGLISH_TEST_RESULTS')) {
      e.ENGLISH_TEST_RESULTS = true; if (!first) first = t('visaDocs2ValidationDocRequired');
    }

    flag('tuitionFeesPaid', tuitionFeesPaid !== null, t('visaDocs2ValidationRequired'));
    if (tuitionFeesPaid === false) {
      flag('tuitionPaymentMethod', tuitionPaymentMethod !== null, t('visaDocs2ValidationRequired'));
    }
    if (requireTuitionPaymentConfirmation && !docMap.has('TUITION_PAYMENT_CONFIRMATION')) {
      e.TUITION_PAYMENT_CONFIRMATION = true; if (!first) first = t('visaDocs2ValidationDocRequired');
    }

    flag('fundsSource', atLeastOneFundsSource, t('visaDocs2ValidationAtLeastOneFundsSource'));
    flag('outwardSource', atLeastOneOutwardSource, t('visaDocs2ValidationAtLeastOneOutwardSource'));

    if (requireInz1014 && !docMap.has('INZ1014_FINANCIAL_UNDERTAKING')) {
      e.INZ1014_FINANCIAL_UNDERTAKING = true; if (!first) first = t('visaDocs2ValidationDocRequired');
    }
    if (requirePrepaidAccom && !docMap.has('PREPAID_ACCOMMODATION_EVIDENCE')) {
      e.PREPAID_ACCOMMODATION_EVIDENCE = true; if (!first) first = t('visaDocs2ValidationDocRequired');
    }
    if (requireOutwardTravelDoc && !docMap.has('OUTWARD_TRAVEL_EVIDENCE')) {
      e.OUTWARD_TRAVEL_EVIDENCE = true; if (!first) first = t('visaDocs2ValidationDocRequired');
    }

    if (showFundsFormat) {
      flag('fundsFormat', atLeastOneFundsFormat, t('visaDocs2ValidationAtLeastOneFundsFormat'));
    }
    if (showSavingsSources) {
      flag('savingsSource', atLeastOneSavingsSource, t('visaDocs2ValidationAtLeastOneSavingsSource'));
      if (!docMap.has('BANK_STATEMENTS')) {
        e.BANK_STATEMENTS = true; if (!first) first = t('visaDocs2ValidationDocRequired');
      }
      if (requireEmploymentIncomeEvidence && !docMap.has('EMPLOYMENT_INCOME_EVIDENCE')) {
        e.EMPLOYMENT_INCOME_EVIDENCE = true; if (!first) first = t('visaDocs2ValidationDocRequired');
      }
    }

    if (scholarshipActive) {
      flag('scholarshipName', scholarshipName.trim() !== '', t('visaDocs2ValidationScholarshipNameRequired'));
      flag('scholarshipOrganisation', scholarshipOrganisation.trim() !== '', t('visaDocs2ValidationScholarshipOrganisationRequired'));
      if (!docMap.has('SCHOLARSHIP_EVIDENCE')) {
        e.SCHOLARSHIP_EVIDENCE = true; if (!first) first = t('visaDocs2ValidationDocRequired');
      }
    }

    flag('studyIs120CreditsOrMore', s?.studyIs120CreditsOrMore !== null && s?.studyIs120CreditsOrMore !== undefined, t('visaDocs2ValidationRequired'));
    flag('courseRequiresPracticalWork', s?.courseRequiresPracticalWork !== null && s?.courseRequiresPracticalWork !== undefined, t('visaDocs2ValidationRequired'));

    flag('declarationChecked', s?.declarationChecked === true, t('visaDocs2ValidationDeclarationRequired'));

    setErrors(e);
    return first;
  };

  const handleSave = async () => {
    setBannerError(null);
    const err = validate();
    if (err) {
      setBannerError(err);
      toast.error(t('visaDocs2ValidationMissing'));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        tuitionFeesPaid,
        tuitionPaymentMethod,
        fundsSourceSavings:      fundsSource.Savings,
        fundsSourceNZSponsor:    fundsSource.NZSponsor,
        fundsSourceInz1014:      fundsSource.Inz1014,
        fundsSourcePrepaidAccom: fundsSource.PrepaidAccom,
        fundsSourceScholarship:  fundsSource.Scholarship,
        outwardSourceSufficientFunds: outwardSource.SufficientFunds,
        outwardSourceInz1014:         outwardSource.Inz1014,
        outwardSourcePrepaidBooking:  outwardSource.PrepaidBooking,
        outwardSourceScholarship:     outwardSource.Scholarship,
        fundsFormatBankAccount:      fundsFormat.BankAccount,
        fundsFormatProvidentFund:    fundsFormat.ProvidentFund,
        fundsFormatEducationLoan:    fundsFormat.EducationLoan,
        fundsFormatFixedTermDeposit: fundsFormat.FixedTermDeposit,
        fundsFormatOther:            fundsFormat.Other,
        savingsSourceWages:          savingsSource.Wages,
        savingsSourceSelfEmployment: savingsSource.SelfEmployment,
        savingsSourceRentalIncome:   savingsSource.RentalIncome,
        savingsSourceOther:          savingsSource.Other,
        depositExplanation:          depositExplanation.trim() || null,
        scholarshipName:             scholarshipActive ? scholarshipName.trim() : null,
        scholarshipOrganisation:     scholarshipActive ? scholarshipOrganisation.trim() : null,
        studyIs120CreditsOrMore:     s?.studyIs120CreditsOrMore,
        courseRequiresPracticalWork: s?.courseRequiresPracticalWork,
        tookEnglishTest:             s?.tookEnglishTest,
        declarationChecked:          s?.declarationChecked,
      };
      const next = await api.patch<ServerPayload>(
        '/students/me/visa/supporting-documents-2',
        payload,
      );
      setS(next);
      setDepositExplanation(next.depositExplanation ?? '');
      setScholarshipName(next.scholarshipName ?? '');
      setScholarshipOrganisation(next.scholarshipOrganisation ?? '');
      // Refresh the page-1 metadata table too — cascade clears may
      // have wiped dependent rows server-side.
      const page1 = await api.get<PickerServerPayload>(
        '/students/me/visa/supporting-documents',
      );
      setDocuments(page1.documents ?? []);
      setSavedAt(new Date().toISOString());
      toast.success(t('visaDocs2SaveSuccess'));
      // Step 15 doesn't exist yet — stay on Step 14 (same fallback
      // used by every prior PR while the next step was unbuilt).
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : t('visaDocs2SaveError');
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

  const Checkbox = ({
    checked, onChange, labelKey,
  }: { checked: boolean | null; onChange: (v: boolean) => void; labelKey: string }) => (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        checked={checked === true}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 cursor-pointer accent-sorena-navy"
      />
      <span className="text-sm text-sorena-navy">
        {t(labelKey as Parameters<typeof t>[0])}
      </span>
    </label>
  );

  const inputClass = (hasError: boolean) =>
    [
      'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');

  if (!loaded || !s) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-sorena-navy/50">
        {t('visaDocs2Loading')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-sorena-navy">{t('visaDocs2SectionTitle')}</h2>
      <p className="text-sm text-sorena-navy/70">{t('visaDocs2Intro')}</p>

      {savedAt && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('visaDocs2SavedBanner')}
        </div>
      )}
      {bannerError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {bannerError}
        </div>
      )}

      {/* Guidance */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocs2SectionGuidance')}</h3>
      </div>
      <p className="text-sm text-sorena-navy/70">{t('visaDocs2GuidanceBody')}</p>

      {/* Evidence of study */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocs2SectionEvidenceOfStudy')}</h3>
      </div>
      <DocumentMetadataPicker
        documentType="OFFER_OF_PLACE"
        label={t('visaDocs2DocOfferOfPlace')}
        required
        metadata={docMap.get('OFFER_OF_PLACE') ?? null}
        onChange={onPickerChange}
        ariaInvalid={!!errors.OFFER_OF_PLACE}
      />
      {isPhd && (
        <DocumentMetadataPicker
          documentType="PHD_RESEARCH_PROPOSAL"
          label={t('visaDocs2DocPhdResearchProposal')}
          required
          metadata={docMap.get('PHD_RESEARCH_PROPOSAL') ?? null}
          onChange={onPickerChange}
          ariaInvalid={!!errors.PHD_RESEARCH_PROPOSAL}
        />
      )}
      {hasPublications && (
        <DocumentMetadataPicker
          documentType="PUBLICATIONS_LIST"
          label={t('visaDocs2DocPublicationsList')}
          required
          helpText={t('visaDocs2DocPublicationsListHelp')}
          metadata={docMap.get('PUBLICATIONS_LIST') ?? null}
          onChange={onPickerChange}
          ariaInvalid={!!errors.PUBLICATIONS_LIST}
        />
      )}

      {/* Evidence of genuine intent */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocs2SectionEvidenceOfGenuineIntent')}</h3>
      </div>
      <DocumentMetadataPicker
        documentType="PERSONAL_CIRCUMSTANCES_EVIDENCE"
        label={t('visaDocs2DocPersonalCircumstancesEvidence')}
        required
        helpText={t('visaDocs2DocPersonalCircumstancesEvidenceHelp')}
        metadata={docMap.get('PERSONAL_CIRCUMSTANCES_EVIDENCE') ?? null}
        onChange={onPickerChange}
        ariaInvalid={!!errors.PERSONAL_CIRCUMSTANCES_EVIDENCE}
      />
      {hasEducationEntries && (
        <DocumentMetadataPicker
          documentType="PREVIOUS_TERTIARY_EVIDENCE"
          label={t('visaDocs2DocPreviousTertiaryEvidence')}
          required
          metadata={docMap.get('PREVIOUS_TERTIARY_EVIDENCE') ?? null}
          onChange={onPickerChange}
          ariaInvalid={!!errors.PREVIOUS_TERTIARY_EVIDENCE}
        />
      )}
      {isCurrentlyEmployed && (
        <DocumentMetadataPicker
          documentType="CURRENT_EMPLOYMENT_EVIDENCE"
          label={t('visaDocs2DocCurrentEmploymentEvidence')}
          required
          metadata={docMap.get('CURRENT_EMPLOYMENT_EVIDENCE') ?? null}
          onChange={onPickerChange}
          ariaInvalid={!!errors.CURRENT_EMPLOYMENT_EVIDENCE}
        />
      )}
      {hasPreviousEmployment && (
        <DocumentMetadataPicker
          documentType="PREVIOUS_EMPLOYMENT_EVIDENCE"
          label={t('visaDocs2DocPreviousEmploymentEvidence')}
          required
          metadata={docMap.get('PREVIOUS_EMPLOYMENT_EVIDENCE') ?? null}
          onChange={onPickerChange}
          ariaInvalid={!!errors.PREVIOUS_EMPLOYMENT_EVIDENCE}
        />
      )}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaDocs2TookEnglishTestLabel')}<Asterisk />
        </p>
        <YesNo
          value={s.tookEnglishTest}
          onChange={(v) => { set({ tookEnglishTest: v }); clearError('tookEnglishTest'); }}
          ariaInvalid={!!errors.tookEnglishTest}
        />
      </div>
      {s.tookEnglishTest === true && (
        <DocumentMetadataPicker
          documentType="ENGLISH_TEST_RESULTS"
          label={t('visaDocs2DocEnglishTestResults')}
          required
          helpText={t('visaDocs2DocEnglishTestResultsHelp')}
          metadata={docMap.get('ENGLISH_TEST_RESULTS') ?? null}
          onChange={onPickerChange}
          ariaInvalid={!!errors.ENGLISH_TEST_RESULTS}
        />
      )}

      {/* Evidence of tuition fees */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocs2SectionTuitionFees')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaDocs2TuitionFeesPaidLabel')}<Asterisk />
        </p>
        <YesNo
          value={tuitionFeesPaid}
          onChange={(v) => {
            set({ tuitionFeesPaid: v, tuitionPaymentMethod: v === true ? null : tuitionPaymentMethod });
            clearError('tuitionFeesPaid');
          }}
          ariaInvalid={!!errors.tuitionFeesPaid}
        />
      </div>
      {tuitionFeesPaid === false && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaDocs2TuitionPaymentMethodLabel')}<Asterisk />
          </p>
          <select
            value={tuitionPaymentMethod ?? ''}
            onChange={(e) => {
              const v = (e.target.value || null) as TuitionPaymentMethod | null;
              set({ tuitionPaymentMethod: v });
              clearError('tuitionPaymentMethod');
            }}
            className={inputClass(!!errors.tuitionPaymentMethod)}
          >
            <option value="">{t('visaCommonSelectPlaceholder')}</option>
            {TUITION_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`visaDocs2TuitionPaymentMethod_${m}` as Parameters<typeof t>[0])}
              </option>
            ))}
          </select>
        </div>
      )}
      {requireTuitionPaymentConfirmation && (
        <DocumentMetadataPicker
          documentType="TUITION_PAYMENT_CONFIRMATION"
          label={t('visaDocs2DocTuitionPaymentConfirmation')}
          required
          helpText={t('visaDocs2DocTuitionPaymentConfirmationHelp')}
          metadata={docMap.get('TUITION_PAYMENT_CONFIRMATION') ?? null}
          onChange={onPickerChange}
          ariaInvalid={!!errors.TUITION_PAYMENT_CONFIRMATION}
        />
      )}

      {/* Financial support */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocs2SectionFinancialSupport')}</h3>
      </div>
      <p className="text-sm text-sorena-navy/70">{t('visaDocs2FinancialSupportIntro')}</p>
      <div className={['flex flex-col gap-2', errors.fundsSource ? 'rounded-lg ring-1 ring-red-400 p-2' : ''].join(' ')}>
        <Checkbox checked={fundsSource.Savings}      onChange={(v) => { set({ fundsSourceSavings: v }); clearError('fundsSource'); }}      labelKey="visaDocs2FundsSourceSavingsLabel" />
        <Checkbox checked={fundsSource.NZSponsor}    onChange={(v) => { set({ fundsSourceNZSponsor: v }); clearError('fundsSource'); }}    labelKey="visaDocs2FundsSourceNZSponsorLabel" />
        <Checkbox checked={fundsSource.Inz1014}      onChange={(v) => { set({ fundsSourceInz1014: v }); clearError('fundsSource'); }}      labelKey="visaDocs2FundsSourceInz1014Label" />
        <Checkbox checked={fundsSource.PrepaidAccom} onChange={(v) => { set({ fundsSourcePrepaidAccom: v }); clearError('fundsSource'); }} labelKey="visaDocs2FundsSourcePrepaidAccomLabel" />
        <Checkbox checked={fundsSource.Scholarship}  onChange={(v) => { set({ fundsSourceScholarship: v }); clearError('fundsSource'); }}  labelKey="visaDocs2FundsSourceScholarshipLabel" />
      </div>

      {/* Outward travel */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocs2SectionOutwardTravel')}</h3>
      </div>
      <div className={['flex flex-col gap-2', errors.outwardSource ? 'rounded-lg ring-1 ring-red-400 p-2' : ''].join(' ')}>
        <Checkbox checked={outwardSource.SufficientFunds} onChange={(v) => { set({ outwardSourceSufficientFunds: v }); clearError('outwardSource'); }} labelKey="visaDocs2OutwardSourceSufficientFundsLabel" />
        <Checkbox checked={outwardSource.Inz1014}         onChange={(v) => { set({ outwardSourceInz1014: v }); clearError('outwardSource'); }}         labelKey="visaDocs2OutwardSourceInz1014Label" />
        <Checkbox checked={outwardSource.PrepaidBooking}  onChange={(v) => { set({ outwardSourcePrepaidBooking: v }); clearError('outwardSource'); }}  labelKey="visaDocs2OutwardSourcePrepaidBookingLabel" />
        <Checkbox checked={outwardSource.Scholarship}     onChange={(v) => { set({ outwardSourceScholarship: v }); clearError('outwardSource'); }}     labelKey="visaDocs2OutwardSourceScholarshipLabel" />
      </div>

      {requireInz1014 && (
        <DocumentMetadataPicker
          documentType="INZ1014_FINANCIAL_UNDERTAKING"
          label={t('visaDocs2DocInz1014')}
          required
          metadata={docMap.get('INZ1014_FINANCIAL_UNDERTAKING') ?? null}
          onChange={onPickerChange}
          ariaInvalid={!!errors.INZ1014_FINANCIAL_UNDERTAKING}
        />
      )}
      {requirePrepaidAccom && (
        <DocumentMetadataPicker
          documentType="PREPAID_ACCOMMODATION_EVIDENCE"
          label={t('visaDocs2DocPrepaidAccommodation')}
          required
          metadata={docMap.get('PREPAID_ACCOMMODATION_EVIDENCE') ?? null}
          onChange={onPickerChange}
          ariaInvalid={!!errors.PREPAID_ACCOMMODATION_EVIDENCE}
        />
      )}
      {requireOutwardTravelDoc && (
        <DocumentMetadataPicker
          documentType="OUTWARD_TRAVEL_EVIDENCE"
          label={t('visaDocs2DocOutwardTravel')}
          required
          metadata={docMap.get('OUTWARD_TRAVEL_EVIDENCE') ?? null}
          onChange={onPickerChange}
          ariaInvalid={!!errors.OUTWARD_TRAVEL_EVIDENCE}
        />
      )}

      {showFundsFormat && (
        <>
          <div className="mt-2 border-t border-sorena-navy/10 pt-6">
            <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocs2SectionFundsFormat')}</h3>
          </div>
          <div className={['flex flex-col gap-2', errors.fundsFormat ? 'rounded-lg ring-1 ring-red-400 p-2' : ''].join(' ')}>
            <Checkbox checked={fundsFormat.BankAccount}      onChange={(v) => { set({ fundsFormatBankAccount: v }); clearError('fundsFormat'); }}      labelKey="visaDocs2FundsFormatBankAccountLabel" />
            <Checkbox checked={fundsFormat.ProvidentFund}    onChange={(v) => { set({ fundsFormatProvidentFund: v }); clearError('fundsFormat'); }}    labelKey="visaDocs2FundsFormatProvidentFundLabel" />
            <Checkbox checked={fundsFormat.EducationLoan}    onChange={(v) => { set({ fundsFormatEducationLoan: v }); clearError('fundsFormat'); }}    labelKey="visaDocs2FundsFormatEducationLoanLabel" />
            <Checkbox checked={fundsFormat.FixedTermDeposit} onChange={(v) => { set({ fundsFormatFixedTermDeposit: v }); clearError('fundsFormat'); }} labelKey="visaDocs2FundsFormatFixedTermDepositLabel" />
            <Checkbox checked={fundsFormat.Other}            onChange={(v) => { set({ fundsFormatOther: v }); clearError('fundsFormat'); }}            labelKey="visaDocs2FundsFormatOtherLabel" />
          </div>
        </>
      )}

      {showSavingsSources && (
        <>
          <div className="mt-2 border-t border-sorena-navy/10 pt-6">
            <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocs2SectionSavingsSources')}</h3>
          </div>
          <div className={['flex flex-col gap-2', errors.savingsSource ? 'rounded-lg ring-1 ring-red-400 p-2' : ''].join(' ')}>
            <Checkbox checked={savingsSource.Wages}          onChange={(v) => { set({ savingsSourceWages: v }); clearError('savingsSource'); }}          labelKey="visaDocs2SavingsSourceWagesLabel" />
            <Checkbox checked={savingsSource.SelfEmployment} onChange={(v) => { set({ savingsSourceSelfEmployment: v }); clearError('savingsSource'); }} labelKey="visaDocs2SavingsSourceSelfEmploymentLabel" />
            <Checkbox checked={savingsSource.RentalIncome}   onChange={(v) => { set({ savingsSourceRentalIncome: v }); clearError('savingsSource'); }}   labelKey="visaDocs2SavingsSourceRentalIncomeLabel" />
            <Checkbox checked={savingsSource.Other}          onChange={(v) => { set({ savingsSourceOther: v }); clearError('savingsSource'); }}          labelKey="visaDocs2SavingsSourceOtherLabel" />
          </div>
          <DocumentMetadataPicker
            documentType="BANK_STATEMENTS"
            label={t('visaDocs2DocBankStatements')}
            required
            helpText={t('visaDocs2DocBankStatementsHelp')}
            metadata={docMap.get('BANK_STATEMENTS') ?? null}
            onChange={onPickerChange}
            ariaInvalid={!!errors.BANK_STATEMENTS}
          />
          {requireEmploymentIncomeEvidence && (
            <DocumentMetadataPicker
              documentType="EMPLOYMENT_INCOME_EVIDENCE"
              label={t('visaDocs2DocEmploymentIncomeEvidence')}
              required
              metadata={docMap.get('EMPLOYMENT_INCOME_EVIDENCE') ?? null}
              onChange={onPickerChange}
              ariaInvalid={!!errors.EMPLOYMENT_INCOME_EVIDENCE}
            />
          )}
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaDocs2DepositExplanationLabel')}
            </label>
            <p className="mb-1.5 text-xs text-sorena-navy/50">
              {t('visaDocs2DepositExplanationHelp')}
            </p>
            <textarea
              rows={4}
              value={depositExplanation}
              onChange={(e) => setDepositExplanation(e.target.value)}
              className={inputClass(false)}
            />
          </div>
        </>
      )}

      {scholarshipActive && (
        <>
          <div className="mt-2 border-t border-sorena-navy/10 pt-6">
            <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocs2ScholarshipSection')}</h3>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaDocs2ScholarshipNameLabel')}<Asterisk />
            </label>
            <input
              type="text"
              value={scholarshipName}
              onChange={(e) => { setScholarshipName(e.target.value); clearError('scholarshipName'); }}
              className={inputClass(!!errors.scholarshipName)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaDocs2ScholarshipOrganisationLabel')}<Asterisk />
            </label>
            <input
              type="text"
              value={scholarshipOrganisation}
              onChange={(e) => { setScholarshipOrganisation(e.target.value); clearError('scholarshipOrganisation'); }}
              className={inputClass(!!errors.scholarshipOrganisation)}
            />
          </div>
          <DocumentMetadataPicker
            documentType="SCHOLARSHIP_EVIDENCE"
            label={t('visaDocs2DocScholarshipEvidence')}
            required
            helpText={t('visaDocs2DocScholarshipEvidenceHelp')}
            metadata={docMap.get('SCHOLARSHIP_EVIDENCE') ?? null}
            onChange={onPickerChange}
            ariaInvalid={!!errors.SCHOLARSHIP_EVIDENCE}
          />
        </>
      )}

      {/* Work rights */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocs2SectionWorkRights')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaDocs2StudyIs120CreditsOrMoreLabel')}<Asterisk />
        </p>
        <YesNo
          value={s.studyIs120CreditsOrMore}
          onChange={(v) => { set({ studyIs120CreditsOrMore: v }); clearError('studyIs120CreditsOrMore'); }}
          ariaInvalid={!!errors.studyIs120CreditsOrMore}
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaDocs2CourseRequiresPracticalWorkLabel')}<Asterisk />
        </p>
        <YesNo
          value={s.courseRequiresPracticalWork}
          onChange={(v) => { set({ courseRequiresPracticalWork: v }); clearError('courseRequiresPracticalWork'); }}
          ariaInvalid={!!errors.courseRequiresPracticalWork}
        />
      </div>
      <DocumentMetadataPicker
        documentType="SCHEDULED_HOLIDAY_EVIDENCE"
        label={t('visaDocs2DocScheduledHoliday')}
        helpText={t('visaDocs2DocScheduledHolidayHelp')}
        metadata={docMap.get('SCHEDULED_HOLIDAY_EVIDENCE') ?? null}
        onChange={onPickerChange}
      />

      {/* Other evidence */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocs2SectionOtherEvidence')}</h3>
      </div>
      <p className="text-sm text-sorena-navy/70">{t('visaDocs2OtherEvidenceIntro')}</p>
      {s.otherEvidence.map((entry) => (
        <OtherEvidenceCard
          key={entry.id}
          entry={entry}
          onServerChange={(next) => onOtherEvidenceChange(next as unknown as ServerPayload)}
        />
      ))}
      <OtherEvidenceAdder
        currentEntries={s.otherEvidence}
        onServerChange={(next) => onOtherEvidenceChange(next as unknown as ServerPayload)}
      />

      {/* Declaration */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaDocs2SectionDeclaration')}</h3>
      </div>
      <label className={['flex cursor-pointer items-start gap-2 rounded-lg p-2', errors.declarationChecked ? 'ring-1 ring-red-400' : ''].join(' ')}>
        <input
          type="checkbox"
          checked={s.declarationChecked === true}
          onChange={(e) => { set({ declarationChecked: e.target.checked }); clearError('declarationChecked'); }}
          className="mt-0.5 h-4 w-4 cursor-pointer accent-sorena-navy"
        />
        <span className="text-sm text-sorena-navy">
          {t('visaDocs2DeclarationCheckedLabel')}<Asterisk />
        </span>
      </label>

      {/* Back + Save row */}
      <div className="flex items-center justify-between border-t border-sorena-navy/10 pt-4">
        <button
          type="button"
          onClick={() => setActiveStep(13)}
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
          {saving ? t('visaCommonSaving') : t('visaDocs2SaveButton')}
        </button>
      </div>
    </div>
  );
}
