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

  currentStep: number;
  createdAt: string;
  updatedAt: string;
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
}

// Total number of Visa Section steps the UI knows how to render. Bumps as
// each later INZ section is built (PR-VISA2 brings this to 2).
export const VISA_TOTAL_STEPS = 2;

const VisaContext = createContext<ContextValue | null>(null);

export function VisaProvider({
  children,
  initialVisa,
  initialReadonly,
}: {
  children: ReactNode;
  initialVisa: VisaApplication;
  initialReadonly: VisaReadonly;
}) {
  const [visa, setVisa] = useState<VisaApplication>(initialVisa);
  const [readonlyState] = useState<VisaReadonly>(initialReadonly);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Clamp the initial step in case the row has a stale value from before
  // VISA_TOTAL_STEPS bumped — we never want the UI in an off-by-one state.
  const [activeStep, setActiveStep] = useState<number>(() =>
    Math.max(1, Math.min(VISA_TOTAL_STEPS, initialVisa.currentStep ?? 1)),
  );

  const patchVisa = useCallback(async (fields: Record<string, unknown>) => {
    const res = await api.patch<{ visaApplication: VisaApplication; readonly: VisaReadonly }>(
      '/students/me/visa/application',
      fields,
    );
    setVisa(res.visaApplication);
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
