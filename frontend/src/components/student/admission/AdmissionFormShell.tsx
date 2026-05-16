'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  AdmissionProvider, useAdmission,
  type Application, type ProgrammeChoice, type EducationEntry, type AdmissionDocument,
} from './AdmissionFormContext';
import { StepNav }          from './StepNav';
import { StageProgressBar } from './StageProgressBar';
import { StepFooter }       from './StepFooter';
import { ReadOnlyView }     from './ReadOnlyView';
import { StepPlaceholder }  from './StepPlaceholder';
import { Step1Study }             from './steps/Step1Study';
import { Step2AdditionalInfo }    from './steps/Step2AdditionalInfo';
import { Step3EducationEnglish }  from './steps/Step3EducationEnglish';
import { Step4Documents }         from './steps/Step4Documents';
import { Step5GuardianInfo }      from './steps/Step5GuardianInfo';
import { Step6Accommodation }     from './steps/Step6Accommodation';
import { Step7AgentDetails }      from './steps/Step7AgentDetails';
import { Step8Acceptance }        from './steps/Step8Acceptance';
import { StudentHeader }    from '@/components/student/StudentHeader';
import type { Session }     from '@/lib/auth';

const STUDENT_STEPS = [1, 2, 3, 4, 5, 6, 8];
const AGENT_STEPS   = [1, 2, 3, 4, 5, 6, 7, 8];

interface InitialData {
  exists: boolean;
  application: Application;
  programmeChoices: ProgrammeChoice[];
  educationEntries: EducationEntry[];
  documents: AdmissionDocument[];
}

interface Props {
  session: Session;
  initialData: InitialData | null;
}

export function AdmissionFormShell({ session, initialData }: Props) {
  const [data, setData] = useState<InitialData | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const t = useTranslations();

  useEffect(() => {
    if (initialData) return;
    api.post<{ application: Application }>('/students/me/admission/application', {})
      .then((res) =>
        setData({ exists: true, application: res.application, programmeChoices: [], educationEntries: [], documents: [] })
      )
      .catch(() => toast.error('Could not start your application. Please refresh.'))
      .finally(() => setLoading(false));
  }, [initialData]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-sorena-navy/50">
        {t('admissionStarting')}
      </div>
    );
  }

  if (!data?.application) return null;

  return (
    <AdmissionProvider
      initialApplication={data.application}
      initialProgrammeChoices={data.programmeChoices}
      initialEducationEntries={data.educationEntries}
      initialDocuments={data.documents}
    >
      <ShellInner session={session} />
    </AdmissionProvider>
  );
}

function ShellInner({ session }: { session: Session }) {
  const t = useTranslations();
  const { currentStep, isReadOnly, application } = useAdmission();
  const isAgent = session.role === 'AGENT';

  // correction 5: guard stale DB data or URL tampering writing step 7 for non-agents
  const safeStep = !isAgent && currentStep === 7 ? 8 : currentStep;
  const visibleSteps = isAgent ? AGENT_STEPS : STUDENT_STEPS;
  const displayStep = visibleSteps.indexOf(safeStep) + 1;

  return (
    <div className="flex flex-col gap-6">
      <StudentHeader
        name={session.name}
        subtitle={t('admissionApply')}
        showBack={false}
      />

      <StageProgressBar currentStep={safeStep} />

      {isReadOnly && <ReadOnlyView applicationId={application!.id} />}

      <div className="flex gap-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <StepNav isAgent={isAgent} />
        </aside>
        <main className="min-w-0 flex-1">
          {safeStep === 1
            ? <Step1Study />
            : safeStep === 2
            ? <Step2AdditionalInfo />
            : safeStep === 3
            ? <Step3EducationEnglish />
            : safeStep === 4
            ? <Step4Documents />
            : safeStep === 5
            ? <Step5GuardianInfo />
            : safeStep === 6
            ? <Step6Accommodation />
            : safeStep === 7
            ? <Step7AgentDetails />
            : safeStep === 8
            ? <Step8Acceptance />
            : <StepPlaceholder step={safeStep} displayStep={displayStep} />
          }
        </main>
      </div>

      {!isReadOnly && <StepFooter isAgent={isAgent} />}
    </div>
  );
}
