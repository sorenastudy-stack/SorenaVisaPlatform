'use client';

import {
  createContext, useCallback, useContext, useEffect, useRef,
  useState, type ReactNode,
} from 'react';
import { api } from '@/lib/api';
import { scrollPortalToTop } from '@/lib/scrollToTop';

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
  dateOfBirth: string;
  maritalStatus: string;
  hasChildren: boolean | null;
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
  schoolCountry: string | null;
  schoolName: string | null;
  schoolQualification: string | null;
  qualificationCompleted: boolean | null;
  qualYearStart: number | null;
  qualYearEnd: number | null;
  lastYearOfSchool: number | null;
  highestQualification: string | null;
  sponsorshipProgramme: string | null;
  hasDisability: boolean | null;
  disabilityDetails: string | null;
  needsEvacAssistance: boolean | null;
  evacDetails: string | null;
  medicalNotes: string | null;
  otherStudyNotes: string | null;
}

export interface Step5Fields {
  guardianRelationship: string | null;
  guardianFirstName: string | null;
  guardianLastName: string | null;
  guardianEmail: string | null;
  guardianMobile: string | null;
  guardianHomePhone: string | null;
  guardianAddressSameAs: boolean | null;
  guardianStreet: string | null;
  guardianSuburb: string | null;
  guardianCity: string | null;
  guardianState: string | null;
  guardianCountry: string | null;
  guardianPostcode: string | null;
}

export interface Step6Fields {
  accommodationType: string | null;
}

export interface Step7Fields {
  counsellorFirstName: string | null;
  counsellorLastName: string | null;
  counsellorEmail: string | null;
  anotherBranch: boolean | null;
  branchAgentCode: string | null;
  branchName: string | null;
  agentDeclarationAgreed: boolean | null;
  agentComments: string | null;
}

export interface Step8Fields {
  termsAgreedAt: string | null;
}

export interface AdmissionDocument {
  id: string;
  documentType: string;
  educationEntryId: string | null;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedAt: string;
}

export interface EducationEntry {
  id: string;
  qualificationLevel: string;
  institutionName: string;
  country: string;
  fieldOfStudy: string | null;
  startYear: number | null;
  endYear: number | null;
  completed: boolean;
  certificateNotReceived: boolean;
  sortOrder: number;
}

export interface EducationEntryInput {
  qualificationLevel: string;
  institutionName: string;
  country: string;
  fieldOfStudy?: string | null;
  startYear?: number | null;
  endYear?: number | null;
  completed?: boolean;
  certificateNotReceived?: boolean;
}

interface ApplicationResponse {
  exists: boolean;
  application: Application;
  programmeChoices: ProgrammeChoice[];
  educationEntries: EducationEntry[];
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
  // PR-SCROLL-TOP: bypass-scroll setter for system reconciliation
  // (e.g., the safeStep sync useEffect in AdmissionFormShell when
  // visibleSteps changes mid-form due to DOB editing). User-initiated
  // navigation uses setCurrentStep above and scrolls; this one does not.
  setCurrentStepSilent: (s: number) => void;
  isReadOnly: boolean;
  patchApplication: (fields: Record<string, unknown>) => Promise<void>;
  submitApplication: () => Promise<void>;
  addProgrammeChoice: (data: { programmeId: string; intakeMonth: number; intakeYear: number }) => Promise<void>;
  removeProgrammeChoice: (choiceId: string) => Promise<void>;
  reorderProgrammeChoices: (orderedIds: string[]) => Promise<void>;
  educationEntries: EducationEntry[];
  addEducationEntry: (data: EducationEntryInput) => Promise<EducationEntry>;
  updateEducationEntry: (entryId: string, data: Partial<EducationEntryInput>) => Promise<EducationEntry>;
  deleteEducationEntry: (entryId: string) => Promise<void>;
  reorderEducationEntries: (orderedIds: string[]) => Promise<void>;
  uploadDocument: (documentType: string, file: File, educationEntryId?: string) => Promise<void>;
  deleteDocument: (documentId: string) => Promise<void>;
  step2Fields: Step2Fields;
  setStep2Fields: (fields: Partial<Step2Fields>) => void;
  step3Fields: Step3Fields;
  setStep3Fields: (fields: Partial<Step3Fields>) => void;
  step5Fields: Step5Fields;
  setStep5Fields: (fields: Partial<Step5Fields>) => void;
  step6Fields: Step6Fields;
  setStep6Fields: (fields: Partial<Step6Fields>) => void;
  step7Fields: Step7Fields;
  setStep7Fields: (fields: Partial<Step7Fields>) => void;
  step8Fields: Step8Fields;
  setStep8Fields: (fields: Partial<Step8Fields>) => void;
  stepHandler: (() => Promise<boolean>) | null;
  registerStepHandler: (fn: (() => Promise<boolean>) | null) => void;
}

const AdmissionContext = createContext<ContextValue | null>(null);

export function AdmissionProvider({
  children,
  initialApplication,
  initialProgrammeChoices,
  initialEducationEntries,
  initialDocuments,
}: {
  children: ReactNode;
  initialApplication: Application | null;
  initialProgrammeChoices: ProgrammeChoice[];
  initialEducationEntries: EducationEntry[];
  initialDocuments: AdmissionDocument[];
}) {
  const [application, setApplication] = useState<Application | null>(initialApplication);
  const [programmeChoices, setProgrammeChoicesRaw] = useState<ProgrammeChoice[]>(initialProgrammeChoices ?? []);
  const [educationEntries, setEducationEntriesRaw] = useState<EducationEntry[]>(initialEducationEntries ?? []);
  const [documents, setDocumentsRaw] = useState<AdmissionDocument[]>(initialDocuments ?? []);
  const [currentStep, setCurrentStepRaw] = useState(initialApplication?.currentStep ?? 1);

  // PR-SCROLL-TOP: scroll the portal <main> back to the top whenever
  // the student crosses to a different step. Guarded by hasMountedRef
  // so first render is silent, and by an equality check so re-sets
  // to the same value are no-ops. Pair with setCurrentStepSilent
  // below for system reconciliation paths that must NOT scroll.
  const hasMountedRef = useRef(false);
  useEffect(() => { hasMountedRef.current = true; }, []);

  const setCurrentStep = useCallback((next: number) => {
    setCurrentStepRaw((prev) => {
      if (next !== prev && hasMountedRef.current) {
        scrollPortalToTop();
      }
      return next;
    });
  }, []);

  // Used by AdmissionFormShell's safeStep reconciliation useEffect —
  // a forced sync (e.g. when DOB editing changes visibleSteps) is not
  // a user-initiated step change, so we bypass the scroll side-effect.
  const setCurrentStepSilent = useCallback((next: number) => {
    setCurrentStepRaw(next);
  }, []);
  const [step2FieldsRaw, setStep2FieldsRaw] = useState<Step2Fields>({
    // dateOfBirth from the DB is an ISO timestamp; HTML date inputs need YYYY-MM-DD.
    dateOfBirth:                        ((initialApplication?.dateOfBirth     as string) ?? '').slice(0, 10),
    maritalStatus:                      (initialApplication?.maritalStatus    as string)          ?? '',
    hasChildren:                        (initialApplication?.hasChildren      as boolean | null)  ?? null,
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
    englishTestSat:         (initialApplication?.englishTestSat         as boolean | null) ?? null,
    englishTestName:        (initialApplication?.englishTestName        as string  | null) ?? null,
    englishPreCourse:       (initialApplication?.englishPreCourse       as boolean | null) ?? null,
    schoolCountry:          (initialApplication?.schoolCountry          as string  | null) ?? null,
    schoolName:             (initialApplication?.schoolName             as string  | null) ?? null,
    schoolQualification:    (initialApplication?.schoolQualification    as string  | null) ?? null,
    qualificationCompleted: (initialApplication?.qualificationCompleted as boolean | null) ?? null,
    qualYearStart:          (initialApplication?.qualYearStart          as number  | null) ?? null,
    qualYearEnd:            (initialApplication?.qualYearEnd            as number  | null) ?? null,
    lastYearOfSchool:       (initialApplication?.lastYearOfSchool       as number  | null) ?? null,
    highestQualification:   (initialApplication?.highestQualification   as string  | null) ?? null,
    sponsorshipProgramme:   (initialApplication?.sponsorshipProgramme   as string  | null) ?? null,
    hasDisability:          (initialApplication?.hasDisability          as boolean | null) ?? null,
    disabilityDetails:      (initialApplication?.disabilityDetails      as string  | null) ?? null,
    needsEvacAssistance:    (initialApplication?.needsEvacAssistance    as boolean | null) ?? null,
    evacDetails:            (initialApplication?.evacDetails            as string  | null) ?? null,
    medicalNotes:           (initialApplication?.medicalNotes           as string  | null) ?? null,
    otherStudyNotes:        (initialApplication?.otherStudyNotes        as string  | null) ?? null,
  });
  const setStep3Fields = useCallback((fields: Partial<Step3Fields>) => {
    setStep3FieldsRaw(prev => ({ ...prev, ...fields }));
  }, []);

  const [step5FieldsRaw, setStep5FieldsRaw] = useState<Step5Fields>({
    guardianRelationship:  (initialApplication?.guardianRelationship  as string  | null) ?? null,
    guardianFirstName:     (initialApplication?.guardianFirstName     as string  | null) ?? null,
    guardianLastName:      (initialApplication?.guardianLastName      as string  | null) ?? null,
    guardianEmail:         (initialApplication?.guardianEmail         as string  | null) ?? null,
    guardianMobile:        (initialApplication?.guardianMobile        as string  | null) ?? null,
    guardianHomePhone:     (initialApplication?.guardianHomePhone     as string  | null) ?? null,
    guardianAddressSameAs: (initialApplication?.guardianAddressSameAs as boolean | null) ?? null,
    guardianStreet:        (initialApplication?.guardianStreet        as string  | null) ?? null,
    guardianSuburb:        (initialApplication?.guardianSuburb        as string  | null) ?? null,
    guardianCity:          (initialApplication?.guardianCity          as string  | null) ?? null,
    guardianState:         (initialApplication?.guardianState         as string  | null) ?? null,
    guardianCountry:       (initialApplication?.guardianCountry       as string  | null) ?? null,
    guardianPostcode:      (initialApplication?.guardianPostcode      as string  | null) ?? null,
  });
  const setStep5Fields = useCallback((fields: Partial<Step5Fields>) => {
    setStep5FieldsRaw(prev => ({ ...prev, ...fields }));
  }, []);

  const [step6FieldsRaw, setStep6FieldsRaw] = useState<Step6Fields>({
    accommodationType: (initialApplication?.accommodationType as string | null) ?? null,
  });
  const setStep6Fields = useCallback((fields: Partial<Step6Fields>) => {
    setStep6FieldsRaw(prev => ({ ...prev, ...fields }));
  }, []);

  const [step7FieldsRaw, setStep7FieldsRaw] = useState<Step7Fields>({
    counsellorFirstName:    (initialApplication?.counsellorFirstName    as string  | null) ?? null,
    counsellorLastName:     (initialApplication?.counsellorLastName     as string  | null) ?? null,
    counsellorEmail:        (initialApplication?.counsellorEmail        as string  | null) ?? null,
    anotherBranch:          (initialApplication?.anotherBranch          as boolean | null) ?? null,
    branchAgentCode:        (initialApplication?.branchAgentCode        as string  | null) ?? null,
    branchName:             (initialApplication?.branchName             as string  | null) ?? null,
    agentDeclarationAgreed: (initialApplication?.agentDeclarationAgreed as boolean | null) ?? null,
    agentComments:          (initialApplication?.agentComments          as string  | null) ?? null,
  });
  const setStep7Fields = useCallback((fields: Partial<Step7Fields>) => {
    setStep7FieldsRaw(prev => ({ ...prev, ...fields }));
  }, []);

  const [step8FieldsRaw, setStep8FieldsRaw] = useState<Step8Fields>({
    termsAgreedAt: (initialApplication?.termsAgreedAt as string | null) ?? null,
  });
  const setStep8Fields = useCallback((fields: Partial<Step8Fields>) => {
    setStep8FieldsRaw(prev => ({ ...prev, ...fields }));
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

  const safeSetEducationEntries = useCallback((v: unknown) => {
    setEducationEntriesRaw(Array.isArray(v) ? v as EducationEntry[] : []);
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
      safeSetEducationEntries(res.educationEntries);
      safeSetDocuments(res.documents);
    }
  }, [safeSetProgrammeChoices, safeSetEducationEntries, safeSetDocuments]);

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

  const uploadDocument = useCallback(async (
    documentType: string,
    file: File,
    educationEntryId?: string,
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('documentType', documentType);
    if (educationEntryId) form.append('educationEntryId', educationEntryId);
    const doc = await api.upload<AdmissionDocument>('/students/me/admission/documents', form);
    setDocumentsRaw(prev => [...prev, doc]);
  }, []);

  const addEducationEntry = useCallback(async (data: EducationEntryInput) => {
    const entry = await api.post<EducationEntry>(
      '/students/me/admission/application/education-entries', data,
    );
    setEducationEntriesRaw(prev => [...prev, entry].sort((a, b) => a.sortOrder - b.sortOrder));
    return entry;
  }, []);

  const updateEducationEntry = useCallback(
    async (entryId: string, data: Partial<EducationEntryInput>) => {
      const entry = await api.patch<EducationEntry>(
        `/students/me/admission/application/education-entries/${entryId}`, data,
      );
      setEducationEntriesRaw(prev =>
        prev.map(e => e.id === entryId ? entry : e),
      );
      return entry;
    }, []);

  const deleteEducationEntry = useCallback(async (entryId: string) => {
    await api.delete<void>(`/students/me/admission/application/education-entries/${entryId}`);
    setEducationEntriesRaw(prev =>
      prev.filter(e => e.id !== entryId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((e, i) => ({ ...e, sortOrder: i })),
    );
    // Also drop any documents that were linked to that entry (cascade on server).
    setDocumentsRaw(prev => prev.filter(d => d.educationEntryId !== entryId));
  }, []);

  const reorderEducationEntries = useCallback(async (orderedIds: string[]) => {
    const res = await api.patch<{ educationEntries: EducationEntry[] }>(
      '/students/me/admission/application/education-entries/reorder',
      { orderedIds },
    );
    safeSetEducationEntries(res.educationEntries);
  }, [safeSetEducationEntries]);

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
      currentStep, setCurrentStep, setCurrentStepSilent,
      isReadOnly,
      patchApplication,
      submitApplication,
      addProgrammeChoice,
      removeProgrammeChoice,
      reorderProgrammeChoices,
      educationEntries,
      addEducationEntry,
      updateEducationEntry,
      deleteEducationEntry,
      reorderEducationEntries,
      uploadDocument,
      deleteDocument,
      step2Fields: step2FieldsRaw,
      setStep2Fields,
      step3Fields: step3FieldsRaw,
      setStep3Fields,
      step5Fields: step5FieldsRaw,
      setStep5Fields,
      step6Fields: step6FieldsRaw,
      setStep6Fields,
      step7Fields: step7FieldsRaw,
      setStep7Fields,
      step8Fields: step8FieldsRaw,
      setStep8Fields,
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
