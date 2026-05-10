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

export interface AdmissionDocument {
  id: string;
  documentType: string;
  originalName: string;
  uploadedAt: string;
}

export interface ApplicationResponse {
  exists: boolean;
  application: Application | null;
  programmeChoices: ProgrammeChoice[];
  documents: AdmissionDocument[];
}

export const admissionApi = {
  getApplication: () =>
    api.get<ApplicationResponse>('/students/me/admission/application'),

  createApplication: () =>
    api.post<{ application: Application }>('/students/me/admission/application', {}),

  updateApplication: (fields: Record<string, unknown>) =>
    api.patch<{ application: Application }>('/students/me/admission/application', fields),

  addProgrammeChoice: (data: { programmeId: string; intakeMonth: number; intakeYear: number }) =>
    api.post<ProgrammeChoice>('/students/me/admission/application/programme-choices', data),

  deleteProgrammeChoice: (choiceId: string) =>
    api.delete<void>(`/students/me/admission/application/programme-choices/${choiceId}`),

  reorderProgrammeChoices: (orderedIds: string[]) =>
    api.patch<ProgrammeChoice[]>(
      '/students/me/admission/application/programme-choices/reorder',
      { orderedIds },
    ),

  submitApplication: () =>
    api.post<{ application: Application }>('/students/me/admission/application/submit', {}),

  uploadDocument: (documentType: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('documentType', documentType);
    return api.upload<AdmissionDocument>('/students/me/admission/documents', form);
  },

  deleteDocument: (documentId: string) =>
    api.delete<void>(`/students/me/admission/documents/${documentId}`),
};
