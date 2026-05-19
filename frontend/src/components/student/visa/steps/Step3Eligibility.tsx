'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useVisa } from '../VisaFormContext';
import { SORENA_AGENT_DETAILS } from '@/lib/sorenaAgent';

// PR-VISA3 — INZ 1200 Section 3 "Eligibility".
// Pre-filled read-only from admission (per docs/VISA_FIELD_INVENTORY.md):
//   - Education provider name → first-priority admission programme choice
//   - Course or programme name → same
// Six free-text "situation and plans" answers persist encrypted; everything
// else is plaintext.
//
// PhD discipline uses the NZSCED top-level Broad Fields of Study. PhD
// subject is a free-text input — the full INZ sub-classification is too
// large to inline and would risk drift; the student types the subject and
// we store the string. The admission inventory has no equivalent field, so
// no auto-mapping was possible.

const MASTERS_OR_PHD_OPTIONS = [
  { value: 'MASTERS', key: 'visaEligibilityMastersOrPhdMasters' as const },
  { value: 'PHD',     key: 'visaEligibilityMastersOrPhdPhd'     as const },
  { value: 'NEITHER', key: 'visaEligibilityMastersOrPhdNeither' as const },
];

const PHD_DISCIPLINE_OPTIONS = [
  { value: 'NATURAL_PHYSICAL_SCIENCES',     key: 'visaEligibilityPhdDisciplineNaturalSciences' as const },
  { value: 'INFORMATION_TECHNOLOGY',        key: 'visaEligibilityPhdDisciplineIT'              as const },
  { value: 'ENGINEERING',                   key: 'visaEligibilityPhdDisciplineEngineering'     as const },
  { value: 'ARCHITECTURE_BUILDING',         key: 'visaEligibilityPhdDisciplineArchitecture'    as const },
  { value: 'AGRICULTURE_ENVIRONMENT',       key: 'visaEligibilityPhdDisciplineAgriculture'     as const },
  { value: 'HEALTH',                        key: 'visaEligibilityPhdDisciplineHealth'          as const },
  { value: 'EDUCATION',                     key: 'visaEligibilityPhdDisciplineEducation'       as const },
  { value: 'MANAGEMENT_COMMERCE',           key: 'visaEligibilityPhdDisciplineManagement'      as const },
  { value: 'SOCIETY_CULTURE',               key: 'visaEligibilityPhdDisciplineSociety'         as const },
  { value: 'CREATIVE_ARTS',                 key: 'visaEligibilityPhdDisciplineCreativeArts'    as const },
  { value: 'FOOD_HOSPITALITY',              key: 'visaEligibilityPhdDisciplineFood'            as const },
  { value: 'MIXED_FIELD',                   key: 'visaEligibilityPhdDisciplineMixed'           as const },
];

const SUPERVISOR_TITLE_OPTIONS = [
  { value: 'MR',    key: 'visaCommonTitleMr'    as const },
  { value: 'MRS',   key: 'visaCommonTitleMrs'   as const },
  { value: 'MISS',  key: 'visaCommonTitleMiss'  as const },
  { value: 'MS',    key: 'visaCommonTitleMs'    as const },
  { value: 'DR',    key: 'visaCommonTitleDr'    as const },
  { value: 'PROF',  key: 'visaCommonTitleProf'  as const },
];

function isoToDateInput(iso: string | null): string {
  return (iso ?? '').slice(0, 10);
}
function dateInputToIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function Step3Eligibility() {
  const t = useTranslations();
  const { visa, readonly, patchVisa, setActiveStep, savedAt, setSavedAt } = useVisa();

  const initial = useMemo(() => ({
    // Study history
    holdsNzStudentVisa:           visa.holdsNzStudentVisa,
    // Offer of Place assistance — only the Y/N is editable; the agent
    // detail fields below are constants (SORENA_AGENT_DETAILS).
    usedEducationAgent:           visa.usedEducationAgent,
    // Study details
    studyingSchoolLevel:          visa.studyingSchoolLevel,
    studyingMastersOrPhd:         visa.studyingMastersOrPhd ?? '',
    studyLocation:                visa.studyLocation ?? '',
    courseRequiresOtherLocation:  visa.courseRequiresOtherLocation,
    courseStartDate:              isoToDateInput(visa.courseStartDate),
    courseEndDate:                isoToDateInput(visa.courseEndDate),
    intendedArrivalDate:          isoToDateInput(visa.intendedArrivalDate),
    // PhD details
    phdDiscipline:                visa.phdDiscipline ?? '',
    phdSubject:                   visa.phdSubject ?? '',
    phdSupervisorTitle:           visa.phdSupervisorTitle ?? '',
    phdSupervisorGivenName:       visa.phdSupervisorGivenName ?? '',
    phdSupervisorSurname:         visa.phdSupervisorSurname ?? '',
    phdSupervisorOrganisation:    visa.phdSupervisorOrganisation ?? '',
    phdPublishedPapers:           visa.phdPublishedPapers,
    phdSupervisorOutsideNz:       visa.phdSupervisorOutsideNz,
    // Student identification number
    providerIssuedStudentId:      visa.providerIssuedStudentId,
    studentIdNumber:              visa.studentIdNumber ?? '',
    // Your situation and plans
    homeCommitments:              visa.homeCommitments ?? '',
    studyRelatesToPrevious:       visa.studyRelatesToPrevious,
    studyRelatesDetails:          visa.studyRelatesDetails ?? '',
    whyStudyNz:                   visa.whyStudyNz ?? '',
    whyThisProvider:              visa.whyThisProvider ?? '',
    howCourseBenefits:            visa.howCourseBenefits ?? '',
    plansAfterStudy:              visa.plansAfterStudy ?? '',
    studyingMultiYear:            visa.studyingMultiYear,
  }), [visa]);

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key as string]) setErrors((prev) => ({ ...prev, [key as string]: false }));
  };

  const isPhd = form.studyingMastersOrPhd === 'PHD';
  const usedAgent = form.usedEducationAgent === true;
  const studyRelates = form.studyRelatesToPrevious === true;
  const hasStudentId = form.providerIssuedStudentId === true;

  const validate = (): string[] => {
    const missing: string[] = [];
    const e: Record<string, boolean> = {};

    // Study history
    if (form.holdsNzStudentVisa === null) { e.holdsNzStudentVisa = true; missing.push('holdsNzStudentVisa'); }

    // Offer of Place assistance — only the Y/N is editable. When Yes, the
    // five SORENA_AGENT_DETAILS values are persisted verbatim on save; the
    // student never enters or validates them.
    if (form.usedEducationAgent === null) { e.usedEducationAgent = true; missing.push('usedEducationAgent'); }

    // Study details
    if (form.studyingSchoolLevel === null)        { e.studyingSchoolLevel = true;        missing.push('studyingSchoolLevel'); }
    if (!form.studyingMastersOrPhd)               { e.studyingMastersOrPhd = true;       missing.push('studyingMastersOrPhd'); }
    if (!readonly.providerName)                   { e.educationProviderName = true;      missing.push('educationProviderName'); }
    if (!readonly.programmeName)                  { e.courseProgrammeName = true;        missing.push('courseProgrammeName'); }
    if (!form.studyLocation.trim())               { e.studyLocation = true;              missing.push('studyLocation'); }
    if (form.courseRequiresOtherLocation === null){ e.courseRequiresOtherLocation = true;missing.push('courseRequiresOtherLocation'); }
    if (!form.courseStartDate)                    { e.courseStartDate = true;            missing.push('courseStartDate'); }
    if (!form.courseEndDate)                      { e.courseEndDate = true;              missing.push('courseEndDate'); }
    if (!form.intendedArrivalDate)                { e.intendedArrivalDate = true;        missing.push('intendedArrivalDate'); }

    // PhD details (only when PhD)
    if (isPhd) {
      if (!form.phdDiscipline)             { e.phdDiscipline = true;             missing.push('phdDiscipline'); }
      if (!form.phdSubject.trim())         { e.phdSubject = true;                missing.push('phdSubject'); }
      if (!form.phdSupervisorTitle)        { e.phdSupervisorTitle = true;        missing.push('phdSupervisorTitle'); }
      if (!form.phdSupervisorGivenName.trim())    { e.phdSupervisorGivenName = true;    missing.push('phdSupervisorGivenName'); }
      if (!form.phdSupervisorSurname.trim())      { e.phdSupervisorSurname = true;      missing.push('phdSupervisorSurname'); }
      if (!form.phdSupervisorOrganisation.trim()) { e.phdSupervisorOrganisation = true; missing.push('phdSupervisorOrganisation'); }
      if (form.phdPublishedPapers === null)       { e.phdPublishedPapers = true;        missing.push('phdPublishedPapers'); }
      if (form.phdSupervisorOutsideNz === null)   { e.phdSupervisorOutsideNz = true;    missing.push('phdSupervisorOutsideNz'); }
    }

    // Student identification number
    if (form.providerIssuedStudentId === null) {
      e.providerIssuedStudentId = true; missing.push('providerIssuedStudentId');
    }
    if (hasStudentId && !form.studentIdNumber.trim()) {
      e.studentIdNumber = true; missing.push('studentIdNumber');
    }

    // Your situation and plans
    if (!form.homeCommitments.trim())   { e.homeCommitments = true;   missing.push('homeCommitments'); }
    if (form.studyRelatesToPrevious === null) {
      e.studyRelatesToPrevious = true; missing.push('studyRelatesToPrevious');
    }
    if (studyRelates && !form.studyRelatesDetails.trim()) {
      e.studyRelatesDetails = true; missing.push('studyRelatesDetails');
    }
    if (!form.whyStudyNz.trim())        { e.whyStudyNz = true;        missing.push('whyStudyNz'); }
    if (!form.whyThisProvider.trim())   { e.whyThisProvider = true;   missing.push('whyThisProvider'); }
    if (!form.howCourseBenefits.trim()) { e.howCourseBenefits = true; missing.push('howCourseBenefits'); }
    if (!form.plansAfterStudy.trim())   { e.plansAfterStudy = true;   missing.push('plansAfterStudy'); }
    if (form.studyingMultiYear === null){ e.studyingMultiYear = true; missing.push('studyingMultiYear'); }

    setErrors(e);
    return missing;
  };

  const handleSave = async () => {
    const missing = validate();
    if (missing.length > 0) {
      toast.error(t('visaEligibilityValidationMissing'));
      return;
    }
    setSaving(true);
    try {
      // Clear off-branch state on save: agent block when not used, PhD
      // block when not PhD, conditional detail/ID text fields when their
      // toggle is off. Keeps stale ciphertext + bad data out of the row.
      const phdActive = isPhd;
      const payload: Record<string, unknown> = {
        // Study history
        holdsNzStudentVisa:           form.holdsNzStudentVisa,
        // Offer of Place assistance — agent details come from the Sorena
        // constants when Yes; null on No. Persisted to the row so the INZ
        // submission carries the agent identity even if the constants are
        // edited later.
        usedEducationAgent:           form.usedEducationAgent,
        agentOrganisationName:        usedAgent ? SORENA_AGENT_DETAILS.organisationName : null,
        agentCountry:                 usedAgent ? SORENA_AGENT_DETAILS.country          : null,
        agentGivenName:               usedAgent ? SORENA_AGENT_DETAILS.givenName        : null,
        agentSurname:                 usedAgent ? SORENA_AGENT_DETAILS.surname          : null,
        agentEmail:                   usedAgent ? SORENA_AGENT_DETAILS.email            : null,
        // Study details (provider + programme are denormalised from admission)
        studyingSchoolLevel:          form.studyingSchoolLevel,
        studyingMastersOrPhd:         form.studyingMastersOrPhd,
        educationProviderName:        readonly.providerName,
        studyLocation:                form.studyLocation.trim(),
        courseRequiresOtherLocation:  form.courseRequiresOtherLocation,
        courseProgrammeName:          readonly.programmeName,
        courseStartDate:              dateInputToIso(form.courseStartDate),
        courseEndDate:                dateInputToIso(form.courseEndDate),
        intendedArrivalDate:          dateInputToIso(form.intendedArrivalDate),
        // PhD details
        phdDiscipline:                phdActive ? form.phdDiscipline             : null,
        phdSubject:                   phdActive ? form.phdSubject.trim()         : null,
        phdSupervisorTitle:           phdActive ? form.phdSupervisorTitle        : null,
        phdSupervisorGivenName:       phdActive ? form.phdSupervisorGivenName.trim()    : null,
        phdSupervisorSurname:         phdActive ? form.phdSupervisorSurname.trim()      : null,
        phdSupervisorOrganisation:    phdActive ? form.phdSupervisorOrganisation.trim() : null,
        phdPublishedPapers:           phdActive ? form.phdPublishedPapers        : null,
        phdSupervisorOutsideNz:       phdActive ? form.phdSupervisorOutsideNz    : null,
        // Student identification number
        providerIssuedStudentId:      form.providerIssuedStudentId,
        studentIdNumber:              hasStudentId ? form.studentIdNumber.trim() : null,
        // Your situation and plans (encrypted at the API layer)
        homeCommitments:              form.homeCommitments.trim(),
        studyRelatesToPrevious:       form.studyRelatesToPrevious,
        studyRelatesDetails:          studyRelates ? form.studyRelatesDetails.trim() : null,
        whyStudyNz:                   form.whyStudyNz.trim(),
        whyThisProvider:              form.whyThisProvider.trim(),
        howCourseBenefits:            form.howCourseBenefits.trim(),
        plansAfterStudy:              form.plansAfterStudy.trim(),
        studyingMultiYear:            form.studyingMultiYear,
        // No Step 4 yet — bump so the stepper opens cleanly there later.
        currentStep:                  4,
      };
      await patchVisa(payload);
      setSavedAt(new Date().toISOString());
      toast.success(t('visaEligibilitySaveSuccess'));
    } catch {
      toast.error(t('visaEligibilitySaveError'));
    } finally {
      setSaving(false);
    }
  };

  // ── Building blocks ─────────────────────────────────────────────────────

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

  // INZ blue/info "NOTE" box — different from green ALERT and red WARNING.
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

  // Narrow variant for native <input type="date"> — keeps the input wide
  // enough for "yyyy-mm-dd" + the calendar picker icon, but doesn't stretch
  // across the form. Same border/error treatment as the regular inputClass.
  const dateInputClass = (hasError: boolean) =>
    [
      'w-44 rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-sorena-navy">{t('visaEligibilitySectionTitle')}</h2>
      <p className="text-sm text-sorena-navy/70">{t('visaEligibilityIntro')}</p>

      {savedAt && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('visaEligibilitySavedBanner')}
        </div>
      )}

      {/* ── Subsection: Study history ──────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaEligibilitySubsectionStudyHistory')}</h3>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEligibilityHoldsNzStudentVisaLabel')}<Asterisk />
        </p>
        <p className="text-sm text-sorena-navy/60">{t('visaEligibilityHoldsNzStudentVisaHelper')}</p>
        <YesNo
          value={form.holdsNzStudentVisa}
          onChange={(v) => update('holdsNzStudentVisa', v)}
          ariaInvalid={errors.holdsNzStudentVisa}
        />
      </div>

      {/* ── Subsection: Offer of Place assistance ─────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaEligibilitySubsectionOfferAssistance')}</h3>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEligibilityUsedAgentLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.usedEducationAgent}
          onChange={(v) => update('usedEducationAgent', v)}
          ariaInvalid={errors.usedEducationAgent}
        />
      </div>

      {usedAgent && (
        <div className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4">
          <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
            {t('visaEligibilityAgentDetailsHeading')}
          </h4>
          <InfoNote>
            <p>{t('visaEligibilityAgentNoteList')}</p>
            <p className="mt-2">{t('visaEligibilityAgentNoteEndorse')}</p>
          </InfoNote>

          {/* All five agent fields are fixed — the agent is always Sorena.
              Values are sourced from SORENA_AGENT_DETAILS and persisted to
              the visa row on save like any other field. */}
          <ReadonlyField
            label={t('visaEligibilityAgentOrgLabel')}
            value={SORENA_AGENT_DETAILS.organisationName}
          />
          <ReadonlyField
            label={t('visaEligibilityAgentCountryLabel')}
            value={SORENA_AGENT_DETAILS.country}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ReadonlyField
              label={t('visaEligibilityAgentGivenNameLabel')}
              value={SORENA_AGENT_DETAILS.givenName}
            />
            <ReadonlyField
              label={t('visaEligibilityAgentSurnameLabel')}
              value={SORENA_AGENT_DETAILS.surname}
            />
          </div>
          <ReadonlyField
            label={t('visaEligibilityAgentEmailLabel')}
            value={SORENA_AGENT_DETAILS.email}
          />
        </div>
      )}

      {/* ── Subsection: Study details ─────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaEligibilitySubsectionStudyDetails')}</h3>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEligibilityStudyingSchoolLevelLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.studyingSchoolLevel}
          onChange={(v) => update('studyingSchoolLevel', v)}
          ariaInvalid={errors.studyingSchoolLevel}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEligibilityMastersOrPhdLabel')}<Asterisk />
        </label>
        <select
          value={form.studyingMastersOrPhd}
          onChange={(e) => update('studyingMastersOrPhd', e.target.value)}
          className={inputClass(!!errors.studyingMastersOrPhd)}
        >
          <option value="" disabled>{t('visaCommonSelectPlaceholder')}</option>
          {MASTERS_OR_PHD_OPTIONS.map(({ value, key }) => (
            <option key={value} value={value}>{t(key)}</option>
          ))}
        </select>
      </div>

      <InfoNote>{t('visaEligibilityMastersOrPhdNote')}</InfoNote>

      {/* Education provider — RO from admission */}
      <ReadonlyField
        label={t('visaEligibilityEducationProviderLabel')}
        value={readonly.providerName ?? ''}
      />
      <p className="-mt-2 text-sm text-sorena-navy/60">{t('visaEligibilityEducationProviderHelper')}</p>

      {/* Study location — fresh */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEligibilityStudyLocationLabel')}<Asterisk />
        </label>
        <input
          type="text"
          value={form.studyLocation}
          onChange={(e) => update('studyLocation', e.target.value)}
          className={inputClass(!!errors.studyLocation)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEligibilityCourseOtherLocationLabel')}<Asterisk />
        </p>
        <p className="text-sm text-sorena-navy/60">{t('visaEligibilityCourseOtherLocationHelper')}</p>
        <YesNo
          value={form.courseRequiresOtherLocation}
          onChange={(v) => update('courseRequiresOtherLocation', v)}
          ariaInvalid={errors.courseRequiresOtherLocation}
        />
      </div>

      {/* Course or programme — RO from admission */}
      <ReadonlyField
        label={t('visaEligibilityCourseProgrammeLabel')}
        value={readonly.programmeName ?? ''}
      />
      <p className="-mt-2 text-sm text-sorena-navy/60">{t('visaEligibilityCourseProgrammeHelper')}</p>

      <p className="text-sm text-sorena-navy/70">{t('visaEligibilityCourseDatesHelper1')}</p>
      <p className="-mt-3 text-sm text-sorena-navy/70">{t('visaEligibilityCourseDatesHelper2')}</p>

      <div className="flex flex-wrap items-end gap-6">
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaEligibilityCourseStartDateLabel')}<Asterisk />
          </label>
          <input
            type="date"
            value={form.courseStartDate}
            onChange={(e) => update('courseStartDate', e.target.value)}
            className={dateInputClass(!!errors.courseStartDate)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaEligibilityCourseEndDateLabel')}<Asterisk />
          </label>
          <input
            type="date"
            value={form.courseEndDate}
            onChange={(e) => update('courseEndDate', e.target.value)}
            className={dateInputClass(!!errors.courseEndDate)}
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEligibilityIntendedArrivalDateLabel')}<Asterisk />
        </label>
        <input
          type="date"
          value={form.intendedArrivalDate}
          onChange={(e) => update('intendedArrivalDate', e.target.value)}
          className={dateInputClass(!!errors.intendedArrivalDate)}
        />
      </div>

      {/* ── Subsection: PhD details (only when PhD) ───────────────── */}
      {isPhd && (
        <>
          <div className="mt-2 border-t border-sorena-navy/10 pt-6">
            <h3 className="text-xl font-bold text-sorena-navy">{t('visaEligibilitySubsectionPhd')}</h3>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaEligibilityPhdDisciplineLabel')}<Asterisk />
            </label>
            <select
              value={form.phdDiscipline}
              onChange={(e) => update('phdDiscipline', e.target.value)}
              className={inputClass(!!errors.phdDiscipline)}
            >
              <option value="" disabled>{t('visaCommonSelectPlaceholder')}</option>
              {PHD_DISCIPLINE_OPTIONS.map(({ value, key }) => (
                <option key={value} value={value}>{t(key)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaEligibilityPhdSubjectLabel')}<Asterisk />
            </label>
            <input
              type="text"
              value={form.phdSubject}
              onChange={(e) => update('phdSubject', e.target.value)}
              className={inputClass(!!errors.phdSubject)}
            />
          </div>

          <p className="text-sm text-sorena-navy/70">{t('visaEligibilityPhdSupervisorHelper')}</p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                {t('visaEligibilityPhdSupervisorTitleLabel')}<Asterisk />
              </label>
              <select
                value={form.phdSupervisorTitle}
                onChange={(e) => update('phdSupervisorTitle', e.target.value)}
                className={inputClass(!!errors.phdSupervisorTitle)}
              >
                <option value="" disabled>{t('visaCommonSelectPlaceholder')}</option>
                {SUPERVISOR_TITLE_OPTIONS.map(({ value, key }) => (
                  <option key={value} value={value}>{t(key)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                {t('visaEligibilityPhdSupervisorGivenNameLabel')}<Asterisk />
              </label>
              <input
                type="text"
                value={form.phdSupervisorGivenName}
                onChange={(e) => update('phdSupervisorGivenName', e.target.value)}
                className={inputClass(!!errors.phdSupervisorGivenName)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                {t('visaEligibilityPhdSupervisorSurnameLabel')}<Asterisk />
              </label>
              <input
                type="text"
                value={form.phdSupervisorSurname}
                onChange={(e) => update('phdSupervisorSurname', e.target.value)}
                className={inputClass(!!errors.phdSupervisorSurname)}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaEligibilityPhdSupervisorOrgLabel')}<Asterisk />
            </label>
            <input
              type="text"
              value={form.phdSupervisorOrganisation}
              onChange={(e) => update('phdSupervisorOrganisation', e.target.value)}
              className={inputClass(!!errors.phdSupervisorOrganisation)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaEligibilityPhdPublishedLabel')}<Asterisk />
            </p>
            <YesNo
              value={form.phdPublishedPapers}
              onChange={(v) => update('phdPublishedPapers', v)}
              ariaInvalid={errors.phdPublishedPapers}
            />
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaEligibilityPhdSupervisorOutsideNzLabel')}<Asterisk />
            </p>
            <YesNo
              value={form.phdSupervisorOutsideNz}
              onChange={(v) => update('phdSupervisorOutsideNz', v)}
              ariaInvalid={errors.phdSupervisorOutsideNz}
            />
          </div>
        </>
      )}

      {/* ── Subsection: Student identification number ─────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaEligibilitySubsectionStudentId')}</h3>
        <p className="mt-2 text-sm text-sorena-navy/70">{t('visaEligibilityStudentIdExplanation1')}</p>
        <p className="mt-2 text-sm text-sorena-navy/70">{t('visaEligibilityStudentIdExplanation2')}</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEligibilityProviderIssuedStudentIdLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.providerIssuedStudentId}
          onChange={(v) => update('providerIssuedStudentId', v)}
          ariaInvalid={errors.providerIssuedStudentId}
        />
        {hasStudentId && (
          <div className="mt-2">
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaEligibilityStudentIdNumberLabel')}<Asterisk />
            </label>
            <input
              type="text"
              value={form.studentIdNumber}
              onChange={(e) => update('studentIdNumber', e.target.value)}
              className={inputClass(!!errors.studentIdNumber)}
            />
          </div>
        )}
      </div>

      {/* ── Subsection: Your situation and plans ──────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaEligibilitySubsectionSituationPlans')}</h3>
        <p className="mt-2 text-sm text-sorena-navy/70">{t('visaEligibilitySituationIntro')}</p>
        <ul className="mt-1 list-disc space-y-1 pl-6 text-sm text-sorena-navy/70">
          <li>{t('visaEligibilitySituationBullet1')}</li>
          <li>{t('visaEligibilitySituationBullet2')}</li>
          <li>{t('visaEligibilitySituationBullet3')}</li>
          <li>{t('visaEligibilitySituationBullet4')}</li>
        </ul>
        <p className="mt-3 text-sm text-sorena-navy/70">{t('visaEligibilitySituationAgentLine')}</p>
        <p className="mt-2 text-sm text-sorena-navy/70">{t('visaEligibilitySituationCoverLetterLine')}</p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEligibilityHomeCommitmentsLabel')}<Asterisk />
        </label>
        <textarea
          rows={5}
          value={form.homeCommitments}
          onChange={(e) => update('homeCommitments', e.target.value)}
          className={inputClass(!!errors.homeCommitments)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEligibilityStudyRelatesLabel')}<Asterisk />
        </p>
        <YesNo
          value={form.studyRelatesToPrevious}
          onChange={(v) => update('studyRelatesToPrevious', v)}
          ariaInvalid={errors.studyRelatesToPrevious}
        />
        {studyRelates && (
          <div className="mt-2">
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaEligibilityStudyRelatesDetailsLabel')}<Asterisk />
            </label>
            <textarea
              rows={4}
              value={form.studyRelatesDetails}
              onChange={(e) => update('studyRelatesDetails', e.target.value)}
              className={inputClass(!!errors.studyRelatesDetails)}
            />
          </div>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEligibilityWhyStudyNzLabel')}<Asterisk />
        </label>
        <textarea
          rows={5}
          value={form.whyStudyNz}
          onChange={(e) => update('whyStudyNz', e.target.value)}
          className={inputClass(!!errors.whyStudyNz)}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEligibilityWhyProviderLabel')}<Asterisk />
        </label>
        <textarea
          rows={5}
          value={form.whyThisProvider}
          onChange={(e) => update('whyThisProvider', e.target.value)}
          className={inputClass(!!errors.whyThisProvider)}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEligibilityHowCourseBenefitsLabel')}<Asterisk />
        </label>
        <textarea
          rows={5}
          value={form.howCourseBenefits}
          onChange={(e) => update('howCourseBenefits', e.target.value)}
          className={inputClass(!!errors.howCourseBenefits)}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEligibilityPlansAfterStudyLabel')}<Asterisk />
        </label>
        <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaEligibilityPlansAfterStudyHelper')}</p>
        <textarea
          rows={5}
          value={form.plansAfterStudy}
          onChange={(e) => update('plansAfterStudy', e.target.value)}
          className={inputClass(!!errors.plansAfterStudy)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaEligibilityMultiYearLabel')}<Asterisk />
        </p>
        <p className="text-sm text-sorena-navy/60">{t('visaEligibilityMultiYearHelper')}</p>
        <YesNo
          value={form.studyingMultiYear}
          onChange={(v) => update('studyingMultiYear', v)}
          ariaInvalid={errors.studyingMultiYear}
        />
      </div>

      {/* Back + Save row */}
      <div className="flex items-center justify-between border-t border-sorena-navy/10 pt-4">
        <button
          type="button"
          onClick={() => setActiveStep(2)}
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
          {saving ? t('visaCommonSaving') : t('visaEligibilitySaveButton')}
        </button>
      </div>
    </div>
  );
}
