'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  VisaProvider, useVisa,
  type VisaApplication,
  type VisaReadonly,
  type OtherCitizenship,
  type TbRiskCountry,
  type EducationEntryRow,
  type EducationSupplement,
  type EmploymentEntry,
  type UnemploymentEntry,
  type VisaPartnerRow,
  type FormerPartnerRow,
  type ChildRow,
  type ParentRow,
  type SiblingRow,
  type NzContactRow,
} from './VisaFormContext';
import { VisaStepper } from './VisaStepper';
import { Step1IdentityDetails } from './steps/Step1IdentityDetails';
import { Step2AddressContact } from './steps/Step2AddressContact';
import { Step3Eligibility } from './steps/Step3Eligibility';
import { Step4Character } from './steps/Step4Character';
import { Step5Health } from './steps/Step5Health';
import { Step6EducationHistory } from './steps/Step6EducationHistory';
import { Step7EmploymentHistory } from './steps/Step7EmploymentHistory';
import { Step8Relationships } from './steps/Step8Relationships';
import { Step9BackgroundDetails } from './steps/Step9BackgroundDetails';
import { Step10MilitaryHistory } from './steps/Step10MilitaryHistory';
import { Step11TravelHistory } from './steps/Step11TravelHistory';
import { Step12ImmigrationAssistance } from './steps/Step12ImmigrationAssistance';
import { Step13SupportingDocuments } from './steps/Step13SupportingDocuments';

interface InitialData {
  visaApplication: VisaApplication;
  readonly: VisaReadonly;
  otherCitizenships: OtherCitizenship[];
  tbRiskCountries: TbRiskCountry[];
  educationEntries: EducationEntryRow[];
  educationSupplements: EducationSupplement[];
  employmentEntries: EmploymentEntry[];
  unemploymentEntries: UnemploymentEntry[];
  partner: VisaPartnerRow | null;
  formerPartners: FormerPartnerRow[];
  children: ChildRow[];
  parents: ParentRow[];
  siblings: SiblingRow[];
  nzContacts: NzContactRow[];
}

interface Props {
  initialData: InitialData | null;
}

// Top-level shell for the Visa Section. Only one section (Identity Details)
// is built so far — the stepper will grow as later INZ 1200 sections land.
// If the row doesn't exist yet, POST creates it on mount (same pattern as
// AdmissionFormShell).
export function VisaFormShell({ initialData }: Props) {
  const t = useTranslations();
  const [data, setData] = useState<InitialData | null>(initialData);
  const [loading, setLoading] = useState(!initialData);

  useEffect(() => {
    if (initialData) return;
    api
      .post<InitialData>('/students/me/visa/application', {})
      .then((res) => setData(res))
      .catch(() => toast.error(t('visaShellStartError')))
      .finally(() => setLoading(false));
  }, [initialData, t]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-sorena-navy/50">
        {t('visaShellLoading')}
      </div>
    );
  }

  if (!data) return null;

  return (
    <VisaProvider
      initialVisa={data.visaApplication}
      initialReadonly={data.readonly}
      initialOtherCitizenships={data.otherCitizenships ?? []}
      initialTbRiskCountries={data.tbRiskCountries ?? []}
      initialEducationEntries={data.educationEntries ?? []}
      initialEducationSupplements={data.educationSupplements ?? []}
      initialEmploymentEntries={data.employmentEntries ?? []}
      initialUnemploymentEntries={data.unemploymentEntries ?? []}
      initialPartner={data.partner ?? null}
      initialFormerPartners={data.formerPartners ?? []}
      initialChildren={data.children ?? []}
      initialParents={data.parents ?? []}
      initialSiblings={data.siblings ?? []}
      initialNzContacts={data.nzContacts ?? []}
    >
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold text-sorena-navy">{t('visaShellTitle')}</h1>
          <p className="mt-1 text-sm text-sorena-navy/60">{t('visaShellHelper')}</p>
        </div>
        <VisaStepper />
        <ActiveStep />
      </div>
    </VisaProvider>
  );
}

// Switch on context.activeStep. Each step component owns its own local form
// state; navigating away unmounts it. The Step 1 "Save and continue" handler
// advances activeStep on success, so the user always lands here mounted on
// the new step with values pre-filled from visa.* (the server-of-record).
function ActiveStep() {
  const { activeStep } = useVisa();
  if (activeStep === 13) return <Step13SupportingDocuments />;
  if (activeStep === 12) return <Step12ImmigrationAssistance />;
  if (activeStep === 11) return <Step11TravelHistory />;
  if (activeStep === 10) return <Step10MilitaryHistory />;
  if (activeStep === 9) return <Step9BackgroundDetails />;
  if (activeStep === 8) return <Step8Relationships />;
  if (activeStep === 7) return <Step7EmploymentHistory />;
  if (activeStep === 6) return <Step6EducationHistory />;
  if (activeStep === 5) return <Step5Health />;
  if (activeStep === 4) return <Step4Character />;
  if (activeStep === 3) return <Step3Eligibility />;
  if (activeStep === 2) return <Step2AddressContact />;
  return <Step1IdentityDetails />;
}
