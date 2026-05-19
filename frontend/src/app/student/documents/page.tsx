import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { apiServer } from '@/lib/apiServer';
import { VisaFormShell } from '@/components/student/visa/VisaFormShell';
import type {
  VisaApplication,
  VisaReadonly,
  OtherCitizenship,
  TbRiskCountry,
  EducationEntryRow,
  EducationSupplement,
} from '@/components/student/visa/VisaFormContext';

interface InitialResponse {
  exists: boolean;
  visaApplication?: VisaApplication;
  readonly: VisaReadonly;
  otherCitizenships?: OtherCitizenship[];
  tbRiskCountries?: TbRiskCountry[];
  educationEntries?: EducationEntryRow[];
  educationSupplements?: EducationSupplement[];
}

// The Visa Section lives at /student/documents (the route is unchanged from
// the old "Documents" stub — see docs/VISA_FIELD_INVENTORY.md and the
// PR that renamed the user-facing label). Server-side fetches the existing
// visa row (or returns "exists: false" with a readonly snapshot). When the
// row doesn't exist yet the client shell POSTs to create it on mount.
export default async function StudentVisaSectionPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/student/documents');

  let initialData:
    | {
        visaApplication: VisaApplication;
        readonly: VisaReadonly;
        otherCitizenships: OtherCitizenship[];
        tbRiskCountries: TbRiskCountry[];
        educationEntries: EducationEntryRow[];
        educationSupplements: EducationSupplement[];
      }
    | null = null;

  try {
    const res = await apiServer.get<InitialResponse>('/students/me/visa/application');
    if (res.exists && res.visaApplication) {
      initialData = {
        visaApplication: res.visaApplication,
        readonly: res.readonly,
        otherCitizenships: res.otherCitizenships ?? [],
        tbRiskCountries: res.tbRiskCountries ?? [],
        educationEntries: res.educationEntries ?? [],
        educationSupplements: res.educationSupplements ?? [],
      };
    }
  } catch {
    // No admission row yet, or other transient error — the shell will surface
    // the failure on mount.
  }

  return <VisaFormShell initialData={initialData} />;
}
