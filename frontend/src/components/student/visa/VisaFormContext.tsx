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
  currentStep: number;
  createdAt: string;
  updatedAt: string;
}

// Read-only snapshot pulled from admission + contacts. The Visa Section
// never re-collects these — they are displayed inline and the student
// edits them on the admission form if a correction is needed.
export interface VisaReadonly {
  fullName: string;
  passportNumber: string | null;
  citizenship: string | null;
  dateOfBirth: string | null;
  countryOfBirth: string | null;
}

interface ContextValue {
  visa: VisaApplication;
  readonly: VisaReadonly;
  patchVisa: (fields: Record<string, unknown>) => Promise<void>;
  savedAt: string | null;
  setSavedAt: (iso: string) => void;
}

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
