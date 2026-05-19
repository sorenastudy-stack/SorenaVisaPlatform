'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  VisaProvider,
  type VisaApplication,
  type VisaReadonly,
} from './VisaFormContext';
import { Step1IdentityDetails } from './steps/Step1IdentityDetails';

interface InitialData {
  visaApplication: VisaApplication;
  readonly: VisaReadonly;
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
    >
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold text-sorena-navy">{t('visaShellTitle')}</h1>
          <p className="mt-1 text-sm text-sorena-navy/60">{t('visaShellHelper')}</p>
        </div>
        <Step1IdentityDetails />
      </div>
    </VisaProvider>
  );
}
