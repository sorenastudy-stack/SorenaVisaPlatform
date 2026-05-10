import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { apiServer } from '@/lib/apiServer';
import { AdmissionFormShell } from '@/components/student/admission/AdmissionFormShell';
import type { Application, ProgrammeChoice, AdmissionDocument } from '@/components/student/admission/AdmissionFormContext';

export default async function AdmissionPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/student/admission');

  let initialData: {
    exists: boolean;
    application: Application;
    programmeChoices: ProgrammeChoice[];
    documents: AdmissionDocument[];
  } | null = null;

  try {
    const res = await apiServer.get<{
      exists: boolean;
      application: Application;
      programmeChoices: ProgrammeChoice[];
      documents: AdmissionDocument[];
    }>('/students/me/admission/application');
    if (res.exists) initialData = res;
  } catch {
    // no application yet — shell POST-creates on mount
  }

  return <AdmissionFormShell session={session} initialData={initialData} />;
}
