'use client';

import {
  createContext, useCallback, useContext, useState,
  type ReactNode,
} from 'react';
import { api } from '@/lib/api';

// All fields are nullable in the DB — the student fills the form over time.
// The shape mirrors what the backend returns from GET/POST/PATCH
// /students/me/visa/application.
export interface VisaApplication {
  id: string;
  applicationId: string;
  // Section 1 — Identity (PR-VISA1)
  hasMononym: boolean | null;
  middleNames: string | null;
  hasUsedOtherNames: boolean | null;
  otherNames: string | null;
  countryWhenSubmitting: string | null;
  prevAppliedNzVisa: boolean | null;
  prevRequestedNzeta: boolean | null;
  everTravelledNz: boolean | null;
  totalNzTime24Plus: boolean | null;
  passportIssueDate: string | null;
  passportExpiryDate: string | null;
  passportCountryOfIssue: string | null;
  passportGender: string | null;
  stateOfBirth: string | null;
  cityOfBirth: string | null;
  hasNationalId: boolean | null;
  nationalId: string | null;
  nationalIdCountry: string | null;
  // Section 2 — Address and contact information (PR-VISA2)
  physicalStreet: string | null;
  physicalSuburb: string | null;
  physicalCity: string | null;
  physicalState: string | null;
  physicalPostcode: string | null;
  physicalCountry: string | null;
  postalSameAsPhysical: boolean | null;
  postalStreet: string | null;
  postalSuburb: string | null;
  postalCity: string | null;
  postalState: string | null;
  postalPostcode: string | null;
  postalCountry: string | null;
  preferredContactCountryCode: string | null;
  preferredContactNumber: string | null;
  alternativeContactCountryCode: string | null;
  alternativeContactNumber: string | null;

  // Section 3 — Eligibility (PR-VISA3)
  holdsNzStudentVisa: boolean | null;
  usedEducationAgent: boolean | null;
  agentOrganisationName: string | null;
  agentCountry: string | null;
  agentGivenName: string | null;
  agentSurname: string | null;
  agentEmail: string | null;
  studyingSchoolLevel: boolean | null;
  studyingMastersOrPhd: string | null;
  educationProviderName: string | null;
  studyLocation: string | null;
  courseRequiresOtherLocation: boolean | null;
  courseProgrammeName: string | null;
  courseStartDate: string | null;
  courseEndDate: string | null;
  intendedArrivalDate: string | null;
  phdDiscipline: string | null;
  phdSubject: string | null;
  phdSupervisorTitle: string | null;
  phdSupervisorGivenName: string | null;
  phdSupervisorSurname: string | null;
  phdSupervisorOrganisation: string | null;
  phdPublishedPapers: boolean | null;
  phdSupervisorOutsideNz: boolean | null;
  providerIssuedStudentId: boolean | null;
  studentIdNumber: string | null;
  homeCommitments: string | null;
  studyRelatesToPrevious: boolean | null;
  studyRelatesDetails: string | null;
  whyStudyNz: string | null;
  whyThisProvider: string | null;
  howCourseBenefits: string | null;
  plansAfterStudy: string | null;
  studyingMultiYear: boolean | null;

  // Section 4 — Character (PR-VISA4)
  everConvicted: boolean | null;
  underInvestigation: boolean | null;
  everDeportedExcluded: boolean | null;
  everRefusedVisa: boolean | null;
  policeCertIssueDate: string | null;
  policeCertCountryOfIssue: string | null;
  policeCertInEnglish: boolean | null;
  holdsOtherCitizenships: boolean | null;
  livedOtherCountry5Years: boolean | null;

  // Section 7 — Employment history (PR-VISA7)
  everGovernmentEmployed: boolean | null;
  everPrisonGuard: boolean | null;
  currentlyWorking: boolean | null;
  hadPreviousEmployment: boolean | null;
  everUnemployed: boolean | null;

  // Section 5 — Health (PR-VISA5)
  hasTuberculosis: boolean | null;
  needsRenalDialysis: boolean | null;
  hasMedicalCondition: boolean | null;
  needsResidentialCare: boolean | null;
  isPregnant: boolean | null;
  intendedLengthOfStay: string | null;
  hadMedicalExam: boolean | null;
  medicalRefNumber: string | null;
  tbCountriesNoMore: boolean | null;
  insuranceDeclarationAgreed: boolean | null;
  publicHealthAckAgreed: boolean | null;

  currentStep: number;
  createdAt: string;
  updatedAt: string;
}

// Repeating child rows for "Do you hold any other citizenships?" = Yes
// (PR-VISA4 fix). Persisted via /students/me/visa/citizenships endpoints,
// returned alongside the visa application on every read.
export interface OtherCitizenship {
  id: string;
  country: string;
  holdsPassport: boolean;
  sortOrder: number;
}

export interface OtherCitizenshipInput {
  country: string;
  holdsPassport: boolean;
}

// Repeating child rows for the Step 5 "TB-risk countries" block
// (PR-VISA5). Persisted via /students/me/visa/tb-countries endpoints.
export interface TbRiskCountry {
  id: string;
  country: string;
  totalDurationDays: number;
  sortOrder: number;
}

export interface TbRiskCountryInput {
  country: string;
  totalDurationDays: number;
}

// Step 6 (PR-VISA6) reads existing admission education entries
// read-only and pairs each with a visa-side supplement holding only the
// INZ-extra fields. Both arrays come back from GET /students/me/visa/
// application; the frontend joins them on educationEntry.id ===
// supplement.educationEntryId.
export interface EducationEntryRow {
  id: string;
  qualificationLevel: string;
  institutionName: string;
  country: string;
  fieldOfStudy: string | null;
  startYear: number | null;
  endYear: number | null;
  completed: boolean;
  sortOrder: number;
}

export interface EducationSupplement {
  id: string;
  educationEntryId: string;
  startMonth: number | null;
  endMonth: number | null;
  institutionState: string | null;
  institutionTown: string | null;
  qualificationAwarded: boolean | null;
}

export interface EducationSupplementPatch {
  startMonth?: number | null;
  endMonth?: number | null;
  institutionState?: string | null;
  institutionTown?: string | null;
  qualificationAwarded?: boolean | null;
}

// Step 7 (PR-VISA7) — jobs table. Same row shape for CURRENT and
// PREVIOUS entries; `entryKind` discriminates. `duties` is the plaintext
// value of the encrypted dutiesEncrypted column.
export interface EmploymentEntry {
  id: string;
  entryKind: 'CURRENT' | 'PREVIOUS' | string;
  startDate: string | null;
  endDate: string | null;
  roleTitle: string | null;
  duties: string | null;
  countryOfWork: string | null;
  stateOfWork: string | null;
  supervisorName: string | null;
  organisationField: string | null;
  organisationCountry: string | null;
  organisationState: string | null;
  employerName: string | null;
  employerStreet: string | null;
  employerSuburb: string | null;
  employerTownCity: string | null;
  employerSubregion: string | null;
  employerRegion: string | null;
  employerPostcode: string | null;
  employerPhone: string | null;
  employerEmail: string | null;
  sortOrder: number;
}

export interface EmploymentEntryPatch {
  startDate?: string | null;
  endDate?: string | null;
  roleTitle?: string | null;
  duties?: string | null;
  countryOfWork?: string | null;
  stateOfWork?: string | null;
  supervisorName?: string | null;
  organisationField?: string | null;
  organisationCountry?: string | null;
  organisationState?: string | null;
  employerName?: string | null;
  employerStreet?: string | null;
  employerSuburb?: string | null;
  employerTownCity?: string | null;
  employerSubregion?: string | null;
  employerRegion?: string | null;
  employerPostcode?: string | null;
  employerPhone?: string | null;
  employerEmail?: string | null;
}

export interface UnemploymentEntry {
  id: string;
  startDate: string | null;
  endDate: string | null;
  activity: string | null;
  financialSupport: string | null;
  sortOrder: number;
}

export interface UnemploymentEntryPatch {
  startDate?: string | null;
  endDate?: string | null;
  activity?: string | null;
  financialSupport?: string | null;
}

// Read-only snapshot pulled from admission + contacts. The Visa Section
// never re-collects these — they are displayed inline and the student
// edits them on the admission/account profile if a correction is needed.
export interface VisaReadonly {
  fullName: string;
  email: string | null;
  countryOfResidence: string | null;
  passportNumber: string | null;
  citizenship: string | null;
  dateOfBirth: string | null;
  countryOfBirth: string | null;
  // PR-VISA3: from admission's first-priority programme choice. Used to
  // pre-fill Step 3's "education provider" + "course or programme name" as
  // read-only so the student doesn't enter the same data twice.
  programmeName: string | null;
  providerName: string | null;
}

interface ContextValue {
  visa: VisaApplication;
  readonly: VisaReadonly;
  patchVisa: (fields: Record<string, unknown>) => Promise<void>;
  // Active step in the UI. Initialised from visa.currentStep on mount, then
  // controlled by the stepper (Back/Save-and-continue). Persisted to the row
  // only when a save advances it — Back is local navigation.
  activeStep: number;
  setActiveStep: (n: number) => void;
  savedAt: string | null;
  setSavedAt: (iso: string) => void;
  // Other-citizenship rows (Step 4 branch). Live-API pattern same as
  // admission education entries: add/update/delete each hit their own
  // endpoint and update local state.
  otherCitizenships: OtherCitizenship[];
  addOtherCitizenship: (data: OtherCitizenshipInput) => Promise<OtherCitizenship>;
  updateOtherCitizenship: (
    id: string,
    data: Partial<OtherCitizenshipInput>,
  ) => Promise<OtherCitizenship>;
  deleteOtherCitizenship: (id: string) => Promise<void>;
  // Clears the in-memory rows. Used by Step 4's save handler after the
  // server reconciles holdsOtherCitizenships → false (server-side delete
  // already happened; this just syncs UI state).
  resetOtherCitizenships: () => void;

  // TB-risk countries (Step 5 block). Same live-API shape.
  tbRiskCountries: TbRiskCountry[];
  addTbRiskCountry: (data: TbRiskCountryInput) => Promise<TbRiskCountry>;
  updateTbRiskCountry: (
    id: string,
    data: Partial<TbRiskCountryInput>,
  ) => Promise<TbRiskCountry>;
  deleteTbRiskCountry: (id: string) => Promise<void>;

  // Step 6 — admission education entries (read-only here) + the visa
  // supplements that hold the INZ-extra columns (live-API upsert).
  educationEntries: EducationEntryRow[];
  educationSupplements: EducationSupplement[];
  upsertEducationSupplement: (
    educationEntryId: string,
    patch: EducationSupplementPatch,
  ) => Promise<EducationSupplement>;

  // Step 7 — employment + unemployment repeating tables.
  employmentEntries: EmploymentEntry[];
  addEmploymentEntry: (entryKind: 'CURRENT' | 'PREVIOUS') => Promise<EmploymentEntry>;
  updateEmploymentEntry: (
    id: string,
    patch: EmploymentEntryPatch,
  ) => Promise<EmploymentEntry>;
  deleteEmploymentEntry: (id: string) => Promise<void>;

  unemploymentEntries: UnemploymentEntry[];
  addUnemploymentEntry: () => Promise<UnemploymentEntry>;
  updateUnemploymentEntry: (
    id: string,
    patch: UnemploymentEntryPatch,
  ) => Promise<UnemploymentEntry>;
  deleteUnemploymentEntry: (id: string) => Promise<void>;
}

// Total number of Visa Section steps the UI knows how to render. Bumps as
// each later INZ section is built (PR-VISA7 brings this to 7).
export const VISA_TOTAL_STEPS = 7;

const VisaContext = createContext<ContextValue | null>(null);

export function VisaProvider({
  children,
  initialVisa,
  initialReadonly,
  initialOtherCitizenships,
  initialTbRiskCountries,
  initialEducationEntries,
  initialEducationSupplements,
  initialEmploymentEntries,
  initialUnemploymentEntries,
}: {
  children: ReactNode;
  initialVisa: VisaApplication;
  initialReadonly: VisaReadonly;
  initialOtherCitizenships: OtherCitizenship[];
  initialTbRiskCountries: TbRiskCountry[];
  initialEducationEntries: EducationEntryRow[];
  initialEducationSupplements: EducationSupplement[];
  initialEmploymentEntries: EmploymentEntry[];
  initialUnemploymentEntries: UnemploymentEntry[];
}) {
  const [visa, setVisa] = useState<VisaApplication>(initialVisa);
  const [readonlyState] = useState<VisaReadonly>(initialReadonly);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [otherCitizenships, setOtherCitizenships] = useState<OtherCitizenship[]>(
    initialOtherCitizenships ?? [],
  );
  const [tbRiskCountries, setTbRiskCountries] = useState<TbRiskCountry[]>(
    initialTbRiskCountries ?? [],
  );
  const [educationEntries] = useState<EducationEntryRow[]>(initialEducationEntries ?? []);
  const [educationSupplements, setEducationSupplements] = useState<EducationSupplement[]>(
    initialEducationSupplements ?? [],
  );
  const [employmentEntries, setEmploymentEntries] = useState<EmploymentEntry[]>(
    initialEmploymentEntries ?? [],
  );
  const [unemploymentEntries, setUnemploymentEntries] = useState<UnemploymentEntry[]>(
    initialUnemploymentEntries ?? [],
  );
  // Clamp the initial step in case the row has a stale value from before
  // VISA_TOTAL_STEPS bumped — we never want the UI in an off-by-one state.
  const [activeStep, setActiveStep] = useState<number>(() =>
    Math.max(1, Math.min(VISA_TOTAL_STEPS, initialVisa.currentStep ?? 1)),
  );

  const patchVisa = useCallback(async (fields: Record<string, unknown>) => {
    const res = await api.patch<{
      visaApplication: VisaApplication;
      readonly: VisaReadonly;
      otherCitizenships?: OtherCitizenship[];
      tbRiskCountries?: TbRiskCountry[];
      educationSupplements?: EducationSupplement[];
      employmentEntries?: EmploymentEntry[];
      unemploymentEntries?: UnemploymentEntry[];
    }>(
      '/students/me/visa/application',
      fields,
    );
    setVisa(res.visaApplication);
    // Backend reconciles the citizenship rows on save (clears them when
    // holdsOtherCitizenships is patched to false). Trust its return value
    // as the new source of truth.
    if (Array.isArray(res.otherCitizenships)) {
      setOtherCitizenships(res.otherCitizenships);
    }
    if (Array.isArray(res.tbRiskCountries)) {
      setTbRiskCountries(res.tbRiskCountries);
    }
    if (Array.isArray(res.educationSupplements)) {
      setEducationSupplements(res.educationSupplements);
    }
    if (Array.isArray(res.employmentEntries)) {
      setEmploymentEntries(res.employmentEntries);
    }
    if (Array.isArray(res.unemploymentEntries)) {
      setUnemploymentEntries(res.unemploymentEntries);
    }
  }, []);

  const addOtherCitizenship = useCallback(async (data: OtherCitizenshipInput) => {
    const row = await api.post<OtherCitizenship>(
      '/students/me/visa/citizenships',
      data,
    );
    setOtherCitizenships(prev =>
      [...prev, row].sort((a, b) => a.sortOrder - b.sortOrder),
    );
    return row;
  }, []);

  const updateOtherCitizenship = useCallback(
    async (id: string, data: Partial<OtherCitizenshipInput>) => {
      const row = await api.patch<OtherCitizenship>(
        `/students/me/visa/citizenships/${id}`,
        data,
      );
      setOtherCitizenships(prev => prev.map(r => (r.id === id ? row : r)));
      return row;
    },
    [],
  );

  const deleteOtherCitizenship = useCallback(async (id: string) => {
    await api.delete<void>(`/students/me/visa/citizenships/${id}`);
    setOtherCitizenships(prev => prev.filter(r => r.id !== id));
  }, []);

  const resetOtherCitizenships = useCallback(() => {
    setOtherCitizenships([]);
  }, []);

  const addTbRiskCountry = useCallback(async (data: TbRiskCountryInput) => {
    const row = await api.post<TbRiskCountry>(
      '/students/me/visa/tb-countries',
      data,
    );
    setTbRiskCountries(prev =>
      [...prev, row].sort((a, b) => a.sortOrder - b.sortOrder),
    );
    return row;
  }, []);

  const updateTbRiskCountry = useCallback(
    async (id: string, data: Partial<TbRiskCountryInput>) => {
      const row = await api.patch<TbRiskCountry>(
        `/students/me/visa/tb-countries/${id}`,
        data,
      );
      setTbRiskCountries(prev => prev.map(r => (r.id === id ? row : r)));
      return row;
    },
    [],
  );

  const deleteTbRiskCountry = useCallback(async (id: string) => {
    await api.delete<void>(`/students/me/visa/tb-countries/${id}`);
    setTbRiskCountries(prev => prev.filter(r => r.id !== id));
  }, []);

  const addEmploymentEntry = useCallback(
    async (entryKind: 'CURRENT' | 'PREVIOUS') => {
      const row = await api.post<EmploymentEntry>(
        '/students/me/visa/employment-entries',
        { entryKind },
      );
      // CURRENT is singleton at the server — replace any existing one
      // locally; PREVIOUS appends.
      setEmploymentEntries((prev) => {
        if (entryKind === 'CURRENT') {
          const others = prev.filter(e => e.entryKind !== 'CURRENT');
          return [...others, row].sort((a, b) => a.sortOrder - b.sortOrder);
        }
        return [...prev, row].sort((a, b) => a.sortOrder - b.sortOrder);
      });
      return row;
    },
    [],
  );

  const updateEmploymentEntry = useCallback(
    async (id: string, patch: EmploymentEntryPatch) => {
      const row = await api.patch<EmploymentEntry>(
        `/students/me/visa/employment-entries/${id}`,
        patch,
      );
      setEmploymentEntries(prev => prev.map(r => (r.id === id ? row : r)));
      return row;
    },
    [],
  );

  const deleteEmploymentEntry = useCallback(async (id: string) => {
    await api.delete<void>(`/students/me/visa/employment-entries/${id}`);
    setEmploymentEntries(prev => prev.filter(r => r.id !== id));
  }, []);

  const addUnemploymentEntry = useCallback(async () => {
    const row = await api.post<UnemploymentEntry>(
      '/students/me/visa/unemployment-entries',
      {},
    );
    setUnemploymentEntries(prev =>
      [...prev, row].sort((a, b) => a.sortOrder - b.sortOrder),
    );
    return row;
  }, []);

  const updateUnemploymentEntry = useCallback(
    async (id: string, patch: UnemploymentEntryPatch) => {
      const row = await api.patch<UnemploymentEntry>(
        `/students/me/visa/unemployment-entries/${id}`,
        patch,
      );
      setUnemploymentEntries(prev => prev.map(r => (r.id === id ? row : r)));
      return row;
    },
    [],
  );

  const deleteUnemploymentEntry = useCallback(async (id: string) => {
    await api.delete<void>(`/students/me/visa/unemployment-entries/${id}`);
    setUnemploymentEntries(prev => prev.filter(r => r.id !== id));
  }, []);

  const upsertEducationSupplement = useCallback(
    async (educationEntryId: string, patch: EducationSupplementPatch) => {
      const row = await api.patch<EducationSupplement>(
        `/students/me/visa/education-supplements/${educationEntryId}`,
        patch,
      );
      setEducationSupplements(prev => {
        const idx = prev.findIndex(s => s.educationEntryId === educationEntryId);
        if (idx === -1) return [...prev, row];
        const next = prev.slice();
        next[idx] = row;
        return next;
      });
      return row;
    },
    [],
  );

  return (
    <VisaContext.Provider value={{
      visa,
      readonly: readonlyState,
      patchVisa,
      activeStep,
      setActiveStep,
      savedAt,
      setSavedAt,
      otherCitizenships,
      addOtherCitizenship,
      updateOtherCitizenship,
      deleteOtherCitizenship,
      resetOtherCitizenships,
      tbRiskCountries,
      addTbRiskCountry,
      updateTbRiskCountry,
      deleteTbRiskCountry,
      educationEntries,
      educationSupplements,
      upsertEducationSupplement,
      employmentEntries,
      addEmploymentEntry,
      updateEmploymentEntry,
      deleteEmploymentEntry,
      unemploymentEntries,
      addUnemploymentEntry,
      updateUnemploymentEntry,
      deleteUnemploymentEntry,
    }}>
      {children}
    </VisaContext.Provider>
  );
}

export function useVisa() {
  const ctx = useContext(VisaContext);
  if (!ctx) throw new Error('useVisa must be used within VisaProvider');
  return ctx;
}
