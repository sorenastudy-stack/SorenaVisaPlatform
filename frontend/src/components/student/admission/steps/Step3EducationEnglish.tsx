'use client';

import { useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useAdmission } from '../AdmissionFormContext';
import { DocumentUploader } from '../DocumentUploader';

const CURRENT_YEAR = new Date().getFullYear();

function isValidYear(n: number | null): boolean {
  if (n === null || !Number.isInteger(n)) return false;
  return n >= 1950 && n <= CURRENT_YEAR + 5;
}

const QUALIFICATION_OPTIONS = [
  { value: 'HIGH_SCHOOL_IN_PROGRESS', key: 'admissionStep3QualOptionHighSchoolInProgress' },
  { value: 'HIGH_SCHOOL_DIPLOMA',     key: 'admissionStep3QualOptionHighSchoolDiploma'    },
  { value: 'FOUNDATION',              key: 'admissionStep3QualOptionFoundation'           },
  { value: 'DIPLOMA',                 key: 'admissionStep3QualOptionDiploma'              },
  { value: 'ASSOCIATE_DEGREE',        key: 'admissionStep3QualOptionAssociateDegree'      },
  { value: 'BACHELORS',               key: 'admissionStep3QualOptionBachelors'            },
  { value: 'POSTGRAD_CERTIFICATE',    key: 'admissionStep3QualOptionPostgradCertificate'  },
  { value: 'POSTGRAD_DIPLOMA',        key: 'admissionStep3QualOptionPostgradDiploma'      },
  { value: 'MASTERS',                 key: 'admissionStep3QualOptionMasters'              },
  { value: 'PHD',                     key: 'admissionStep3QualOptionPhd'                  },
  { value: 'OTHER',                   key: 'admissionStep3QualOptionOther'                },
] as const;

const SPONSORSHIP_OPTIONS = [
  { value: 'SELF_FUNDED',  key: 'admissionStep3SponsorshipOptionSelfFunded'  },
  { value: 'FAMILY',       key: 'admissionStep3SponsorshipOptionFamily'      },
  { value: 'SCHOLARSHIP',  key: 'admissionStep3SponsorshipOptionScholarship' },
  { value: 'EMPLOYER',     key: 'admissionStep3SponsorshipOptionEmployer'    },
  { value: 'GOVERNMENT',   key: 'admissionStep3SponsorshipOptionGovernment'  },
  { value: 'OTHER',        key: 'admissionStep3SponsorshipOptionOther'       },
] as const;

export function Step3EducationEnglish() {
  const t = useTranslations();
  const {
    step3Fields, setStep3Fields,
    documents,
    patchApplication, registerStepHandler,
  } = useAdmission();
  const {
    englishTestSat, englishTestName, englishPreCourse,
    schoolCountry, schoolName, schoolQualification, qualificationCompleted,
    qualYearStart, qualYearEnd, lastYearOfSchool, highestQualification,
    sponsorshipProgramme,
  } = step3Fields;

  const handler = useCallback(async (): Promise<boolean> => {
    // Q1 — English test sat
    if (englishTestSat === null) {
      toast.error(t('admissionStep3ValidationQuestion'));
      return false;
    }
    if (englishTestSat === true) {
      if (!englishTestName?.trim()) {
        toast.error(t('admissionStep3ValidationTestName'));
        return false;
      }
      if (!documents.some(d => d.documentType === 'ENGLISH_TEST_EVIDENCE')) {
        toast.error(t('admissionStep3ValidationEvidence'));
        return false;
      }
    }
    // Q2 — English pre-course
    if (englishPreCourse === null) {
      toast.error(t('admissionStep3ValidationQuestion2'));
      return false;
    }
    // Education
    if (!schoolCountry) {
      toast.error(t('admissionStep3ValidationSchoolCountry'));
      return false;
    }
    if (!schoolName?.trim()) {
      toast.error(t('admissionStep3ValidationSchoolName'));
      return false;
    }
    if (!schoolQualification?.trim()) {
      toast.error(t('admissionStep3ValidationSchoolQualification'));
      return false;
    }
    if (qualificationCompleted === null) {
      toast.error(t('admissionStep3ValidationQualificationCompleted'));
      return false;
    }
    if (qualificationCompleted === true) {
      if (!isValidYear(qualYearStart)) {
        toast.error(t('admissionStep3ValidationQualYearStart'));
        return false;
      }
      if (!isValidYear(qualYearEnd) || (qualYearStart !== null && qualYearEnd! < qualYearStart)) {
        toast.error(t('admissionStep3ValidationQualYearEnd'));
        return false;
      }
    }
    if (qualificationCompleted === false) {
      if (!isValidYear(lastYearOfSchool)) {
        toast.error(t('admissionStep3ValidationLastYearOfSchool'));
        return false;
      }
      if (!highestQualification?.trim()) {
        toast.error(t('admissionStep3ValidationHighestQualification'));
        return false;
      }
    }
    if (!documents.some(d => d.documentType === 'EDUCATION_TRANSCRIPTS')) {
      toast.error(t('admissionStep3ValidationTranscripts'));
      return false;
    }
    // PATCH
    try {
      const patchBody: Record<string, unknown> = {
        englishTestSat,
        englishPreCourse,
        qualificationCompleted,
      };
      if (englishTestSat) patchBody.englishTestName = englishTestName;
      if (schoolCountry) patchBody.schoolCountry = schoolCountry;
      if (schoolName) patchBody.schoolName = schoolName;
      if (schoolQualification) patchBody.schoolQualification = schoolQualification;
      if (qualYearStart !== null) patchBody.qualYearStart = qualYearStart;
      if (qualYearEnd !== null) patchBody.qualYearEnd = qualYearEnd;
      if (lastYearOfSchool !== null) patchBody.lastYearOfSchool = lastYearOfSchool;
      if (highestQualification) patchBody.highestQualification = highestQualification;
      if (sponsorshipProgramme) patchBody.sponsorshipProgramme = sponsorshipProgramme;
      await patchApplication(patchBody);
      return true;
    } catch {
      return false;
    }
  }, [
    englishTestSat, englishTestName, englishPreCourse,
    schoolCountry, schoolName, schoolQualification, qualificationCompleted,
    qualYearStart, qualYearEnd, lastYearOfSchool, highestQualification,
    sponsorshipProgramme,
    documents, patchApplication, t,
  ]);

  useEffect(() => {
    registerStepHandler(handler);
    return () => registerStepHandler(null);
  }, [handler, registerStepHandler]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-bold text-sorena-navy">{t('admissionStep3Title')}</h2>
        <p className="mt-1 text-sm text-sorena-navy/60">{t('admissionStep3Helper')}</p>
      </div>

      {/* Question 1 — English test sat */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep3Question1Label')}
          <span className="ml-0.5 text-red-500">*</span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStep3Fields({ englishTestSat: true })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              englishTestSat === true
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3Question1OptionYes')}
          </button>
          <button
            type="button"
            onClick={() => setStep3Fields({ englishTestSat: false })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              englishTestSat === false
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3Question1OptionNo')}
          </button>
        </div>
      </div>

      {/* Conditional — test name + evidence upload */}
      {englishTestSat === true && (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep3TestNameLabel')}
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="text"
              value={englishTestName ?? ''}
              onChange={(e) => setStep3Fields({ englishTestName: e.target.value })}
              placeholder={t('admissionStep3TestNamePlaceholder')}
              className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
            />
          </div>

          <DocumentUploader
            documentType="ENGLISH_TEST_EVIDENCE"
            label={t('admissionStep3UploadEvidenceLabel')}
            helperText={t('admissionStep3UploadEvidenceHelper')}
            single={false}
            required={true}
          />
        </>
      )}

      {/* Question 2 — English pre-course */}
      <div className="flex flex-col gap-2">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionStep3Question2Label')}
            <span className="ml-0.5 text-red-500">*</span>
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-sorena-navy/60">
            {t('admissionStep3Question2Helper')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStep3Fields({ englishPreCourse: true })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              englishPreCourse === true
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3Question1OptionYes')}
          </button>
          <button
            type="button"
            onClick={() => setStep3Fields({ englishPreCourse: false })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              englishPreCourse === false
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3Question1OptionNo')}
          </button>
        </div>
        {englishPreCourse === true && (
          <p className="mt-3 text-sm text-sorena-navy/80">
            {t('admissionStep3Question2YesConfirmation')}
          </p>
        )}
      </div>

      {/* Education section */}
      <div>
        <h3 className="text-lg font-bold text-sorena-navy">{t('admissionStep3EducationSectionTitle')}</h3>
      </div>

      {/* schoolCountry — NZ vs Overseas pills */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep3SchoolCountryLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStep3Fields({ schoolCountry: 'NEW_ZEALAND' })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              schoolCountry === 'NEW_ZEALAND'
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3SchoolCountryNZ')}
          </button>
          <button
            type="button"
            onClick={() => setStep3Fields({ schoolCountry: 'OVERSEAS' })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              schoolCountry === 'OVERSEAS'
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3SchoolCountryOverseas')}
          </button>
        </div>
      </div>

      {/* schoolName */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep3SchoolNameLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </label>
        <input
          type="text"
          value={schoolName ?? ''}
          onChange={(e) => setStep3Fields({ schoolName: e.target.value })}
          placeholder={t('admissionStep3SchoolNamePlaceholder')}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
        />
      </div>

      {/* schoolQualification */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep3SchoolQualificationLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </label>
        <select
          value={schoolQualification ?? ''}
          onChange={(e) => setStep3Fields({ schoolQualification: e.target.value || null })}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
        >
          <option value="" disabled>{t('admissionStep3SchoolQualificationPlaceholder')}</option>
          {QUALIFICATION_OPTIONS.map(({ value, key }) => (
            <option key={value} value={value}>{t(key)}</option>
          ))}
        </select>
      </div>

      {/* qualificationCompleted */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep3QualificationCompletedLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStep3Fields({ qualificationCompleted: true })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              qualificationCompleted === true
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3Question1OptionYes')}
          </button>
          <button
            type="button"
            onClick={() => setStep3Fields({ qualificationCompleted: false })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              qualificationCompleted === false
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3Question1OptionNo')}
          </button>
        </div>
      </div>

      {/* Conditional — qualYearStart + qualYearEnd when completed === true */}
      {qualificationCompleted === true && (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep3QualYearStartLabel')}
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="number"
              min={1950}
              max={CURRENT_YEAR + 5}
              value={qualYearStart ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setStep3Fields({ qualYearStart: v === '' ? null : parseInt(v, 10) });
              }}
              placeholder={t('admissionStep3QualYearStartPlaceholder')}
              className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep3QualYearEndLabel')}
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="number"
              min={1950}
              max={CURRENT_YEAR + 5}
              value={qualYearEnd ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setStep3Fields({ qualYearEnd: v === '' ? null : parseInt(v, 10) });
              }}
              placeholder={t('admissionStep3QualYearEndPlaceholder')}
              className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
            />
          </div>
        </>
      )}

      {/* Conditional — lastYearOfSchool + highestQualification when completed === false */}
      {qualificationCompleted === false && (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep3LastYearOfSchoolLabel')}
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="number"
              min={1950}
              max={CURRENT_YEAR + 5}
              value={lastYearOfSchool ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setStep3Fields({ lastYearOfSchool: v === '' ? null : parseInt(v, 10) });
              }}
              placeholder={t('admissionStep3LastYearOfSchoolPlaceholder')}
              className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep3HighestQualificationLabel')}
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="text"
              value={highestQualification ?? ''}
              onChange={(e) => setStep3Fields({ highestQualification: e.target.value })}
              placeholder={t('admissionStep3HighestQualificationPlaceholder')}
              className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
            />
          </div>
        </>
      )}

      {/* Education transcripts upload */}
      <div className="flex flex-col gap-3">
        <p className="text-sm text-sorena-navy/80">
          {t('admissionStep3UploadTranscriptsHelper')}
        </p>
        <ul className="list-disc space-y-1 pl-6 text-sm text-sorena-navy/80">
          <li>{t('admissionStep3UploadTranscriptsBullet1')}</li>
          <li>{t('admissionStep3UploadTranscriptsBullet2')}</li>
        </ul>
        <p className="text-sm text-sorena-navy/80">
          {t('admissionStep3UploadTranscriptsTranslationNote')}
        </p>
      </div>

      <DocumentUploader
        documentType="EDUCATION_TRANSCRIPTS"
        label={t('admissionStep3UploadTranscriptsLabel')}
        helperText={t('admissionStep3UploadTranscriptsFileFormat')}
        single={false}
        required={true}
      />

      {/* Funding section */}
      <div>
        <h3 className="text-lg font-bold text-sorena-navy">{t('admissionStep3FundingSectionTitle')}</h3>
      </div>

      {/* sponsorshipProgramme — optional dropdown */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep3SponsorshipProgrammeLabel')}
        </label>
        <select
          value={sponsorshipProgramme ?? ''}
          onChange={(e) => setStep3Fields({ sponsorshipProgramme: e.target.value || null })}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
        >
          <option value="" disabled>{t('admissionStep3SponsorshipProgrammePlaceholder')}</option>
          {SPONSORSHIP_OPTIONS.map(({ value, key }) => (
            <option key={value} value={value}>{t(key)}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
