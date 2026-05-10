'use client';

import {
  createContext, useCallback, useContext,
  useState, type ReactNode,
} from 'react';
import { api } from '@/lib/api';

export interface Application {
  id: string;
  status: string;
  currentStep: number;
  [key: string]: unknown;
}

export interface ProgrammeChoice {
  id: string;
  programmeId: string;
  priority: number;
  intakeMonth: number;
  intakeYear: number;
}

export interface Step2Fields {
  phone: string;
  phoneType: string;
  countryOfBirth: string;
  citizenship: string;
  ethnicity: string;
  passportNumber: string;
  respondedYesToAdditionalQuestion: boolean | null;
}

export interface Step3Fields {
  englishTestSat: boolean | null;
  englishTestName: string | null;
  englishPreCourse: boolean | null;
}

export interface AdmissionDocument {
  id: string;
  documentType: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedAt: string;
}

interface ApplicationResponse {
  exists: boolean;
  application: Application;
  programmeChoices: ProgrammeChoice[];
  documents: AdmissionDocument[];
}

interface ContextValue {
  application: Application | null;
  setApplication: (app: Application) => void;
  programmeChoices: ProgrammeChoice[];
  setProgrammeChoices: (c: ProgrammeChoice[]) => void;
  documents: AdmissionDocument[];
  setDocuments: (d: AdmissionDocument[]) => void;
  currentStep: number;
  setCurrentStep: (s: number) => void;
  isReadOnly: boolean;
  patchApplication: (fields: Record<string, unknown>) => Promise<void>;
  submitApplication: () => Promise<void>;
  addProgrammeChoice: (data: { programmeId: string; intakeMonth: number; intakeYear: number }) => Promise<void>;
  removeProgrammeChoice: (choiceId: string) => Promise<void>;
  reorderProgrammeChoices: (orderedIds: string[]) => Promise<void>;
  uploadDocument: (documentType: string, file: File) => Promise<void>;
  deleteDocument: (documentId: string) => Promise<void>;
  step2Fields: Step2Fields;
  setStep2Fields: (fields: Partial<Step2Fields>) => void;
  step3Fields: Step3Fields;
  setStep3Fields: (fields: Partial<Step3Fields>) => void;
  stepHandler: (() => Promise<boolean>) | null;
  registerStepHandler: (fn: (() => Promise<boolean>) | null) => void;
}

const AdmissionContext = createContext<ContextValue | null>(null);

export function AdmissionProvider({
  children,
  initialApplication,
  initialProgrammeChoices,
  initialDocuments,
}: {
  children: ReactNode;
  initialApplication: Application | null;
  initialProgrammeChoices: ProgrammeChoice[];
  initialDocuments: AdmissionDocument[];
}) {
  const [application, setApplication] = useState<Application | null>(initialApplication);
  const [programmeChoices, setProgrammeChoicesRaw] = useState<ProgrammeChoice[]>(initialProgrammeChoices ?? []);
  const [documents, setDocumentsRaw] = useState<AdmissionDocument[]>(initialDocuments ?? []);
  const [currentStep, setCurrentStep] = useState(initialApplication?.currentStep ?? 1);
  const [step2FieldsRaw, setStep2FieldsRaw] = useState<Step2Fields>({
    phone:                              (initialApplication?.phone            as string)          ?? '',
    phoneType:                          (initialApplication?.phoneType        as string)          ?? '',
    countryOfBirth:                     (initialApplication?.countryOfBirth   as string)          ?? '',
    citizenship:                        (initialApplication?.citizenship      as string)          ?? '',
    ethnicity:                          (initialApplication?.ethnicity        as string)          ?? '',
    passportNumber:                     (initialApplication?.passportNumber   as string)          ?? '',
    respondedYesToAdditionalQuestion:   (initialApplication?.visaRefused      as boolean | null)  ?? null,
  });
  const setStep2Fields = useCallback((fields: Partial<Step2Fields>) => {
    setStep2FieldsRaw(prev => ({ ...prev, ...fields }));
  }, []);

  const [step3FieldsRaw, setStep3FieldsRaw] = useState<Step3Fields>({
    englishTestSat:   (initialApplication?.englishTestSat   as boolean | null) ?? null,
    englishTestName:  (initialApplication?.englishTestName  as string  | null) ?? null,
    englishPreCourse: (initialApplication?.englishPreCourse as boolean | null) ?? null,
  });
  const setStep3Fields = useCallback((fields: Partial<Step3Fields>) => {
    setStep3FieldsRaw(prev => ({ ...prev, ...fields }));
  }, []);

  const [stepHandler, setStepHandlerState] = useState<(() => Promise<boolean>) | null>(null);
  const registerStepHandler = useCallback((fn: (() => Promise<boolean>) | null) => {
    setStepHandlerState(fn !== null ? () => fn : null);
  }, []);

  // Layer B: defensive setters — guard against non-array API responses landing in state
  const safeSetProgrammeChoices = useCallback((v: unknown) => {
    setProgrammeChoicesRaw(Array.isArray(v) ? v as ProgrammeChoice[] : []);
  }, []);

  const safeSetDocuments = useCallback((v: unknown) => {
    setDocumentsRaw(Array.isArray(v) ? v as AdmissionDocument[] : []);
  }, []);

  // correction 2: LOCKED is also read-only
  const isReadOnly =
    application?.status === 'SUBMITTED' || application?.status === 'LOCKED';

  const patchApplication = useCallback(async (fields: Record<string, unknown>) => {
    const res = await api.patch<{ application: Application }>(
      '/students/me/admission/application',
      fields,
    );
    setApplication(res.application);
  }, []);

  // correction 4: POST submit then GET to refresh all state so isReadOnly flips immediately
  const submitApplication = useCallback(async () => {
    await api.post<unknown>('/students/me/admission/application/submit', {});
    const res = await api.get<ApplicationResponse>('/students/me/admission/application');
    if (res.application) {
      setApplication(res.application);
      safeSetProgrammeChoices(res.programmeChoices);
      safeSetDocuments(res.documents);
    }
  }, [safeSetProgrammeChoices, safeSetDocuments]);

  const addProgrammeChoice = useCallback(
    async (data: { programmeId: string; intakeMonth: number; intakeYear: number }) => {
      const choice = await api.post<ProgrammeChoice>(
        '/students/me/admission/application/programme-choices', data,
      );
      // functional update: use raw setter so prev is always the current array
      setProgrammeChoicesRaw(prev => [...prev, choice]);
    }, []);

  // correction 2: re-number priorities locally after remove
  const removeProgrammeChoice = useCallback(async (choiceId: string) => {
    await api.delete<void>(`/students/me/admission/application/programme-choices/${choiceId}`);
    setProgrammeChoicesRaw(prev =>
      prev.filter(c => c.id !== choiceId)
        .sort((a, b) => a.priority - b.priority)
        .map((c, i) => ({ ...c, priority: i + 1 }))
    );
  }, []);

  const uploadDocument = useCallback(async (documentType: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('documentType', documentType);
    const doc = await api.upload<AdmissionDocument>('/students/me/admission/documents', form);
    setDocumentsRaw(prev => [...prev, doc]);
  }, []);

  const deleteDocument = useCallback(async (documentId: string) => {
    await api.delete<void>(`/students/me/admission/documents/${documentId}`);
    setDocumentsRaw(prev => prev.filter(d => d.id !== documentId));
  }, []);

  // Layer A fix: PATCH reorder returns loadFullApplication shape { exists, application, programmeChoices, documents }
  // NOT a bare ProgrammeChoice[]. Unwrap the programmeChoices field.
  const reorderProgrammeChoices = useCallback(async (orderedIds: string[]) => {
    const res = await api.patch<{ programmeChoices: ProgrammeChoice[] }>(
      '/students/me/admission/application/programme-choices/reorder',
      { orderedIds },
    );
    safeSetProgrammeChoices(res.programmeChoices);
  }, [safeSetProgrammeChoices]);

  return (
    <AdmissionContext.Provider value={{
      application, setApplication,
      programmeChoices, setProgrammeChoices: safeSetProgrammeChoices,
      documents, setDocuments: safeSetDocuments,
      currentStep, setCurrentStep,
      isReadOnly,
      patchApplication,
      submitApplication,
      addProgrammeChoice,
      removeProgrammeChoice,
      reorderProgrammeChoices,
      uploadDocument,
      deleteDocument,
      step2Fields: step2FieldsRaw,
      setStep2Fields,
      step3Fields: step3FieldsRaw,
      setStep3Fields,
      stepHandler,
      registerStepHandler,
    }}>
      {children}
    </AdmissionContext.Provider>
  );
}

export function useAdmission() {
  const ctx = useContext(AdmissionContext);
  if (!ctx) throw new Error('useAdmission must be used within AdmissionProvider');
  return ctx;
}
