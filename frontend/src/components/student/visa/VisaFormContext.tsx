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
}

// Total number of Visa Section steps the UI knows how to render. Bumps as
// each later INZ section is built (PR-VISA5 brings this to 5).
export const VISA_TOTAL_STEPS = 5;

const VisaContext = createContext<ContextValue | null>(null);

export function VisaProvider({
  children,
  initialVisa,
  initialReadonly,
  initialOtherCitizenships,
  initialTbRiskCountries,
}: {
  children: ReactNode;
  initialVisa: VisaApplication;
  initialReadonly: VisaReadonly;
  initialOtherCitizenships: OtherCitizenship[];
  initialTbRiskCountries: TbRiskCountry[];
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
