import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { apiServer } from '@/lib/apiServer';
import { VisaFormShell } from '@/components/student/visa/VisaFormShell';
import { PaymentGatePanel } from '@/components/portal/PaymentGatePanel';
import type {
  VisaApplication,
  VisaReadonly,
  OtherCitizenship,
  TbRiskCountry,
  EducationEntryRow,
  EducationSupplement,
  EmploymentEntry,
  UnemploymentEntry,
  VisaPartnerRow,
  FormerPartnerRow,
  ChildRow,
  ParentRow,
  SiblingRow,
  NzContactRow,
} from '@/components/student/visa/VisaFormContext';

interface InitialResponse {
  exists: boolean;
  visaApplication?: VisaApplication;
  readonly: VisaReadonly;
  otherCitizenships?: OtherCitizenship[];
  tbRiskCountries?: TbRiskCountry[];
  educationEntries?: EducationEntryRow[];
  educationSupplements?: EducationSupplement[];
  employmentEntries?: EmploymentEntry[];
  unemploymentEntries?: UnemploymentEntry[];
  partner?: VisaPartnerRow | null;
  formerPartners?: FormerPartnerRow[];
  children?: ChildRow[];
  parents?: ParentRow[];
  siblings?: SiblingRow[];
  nzContacts?: NzContactRow[];
}

// The Visa Section lives at /student/documents (the route is unchanged from
// the old "Documents" stub — see docs/VISA_FIELD_INVENTORY.md and the
// PR that renamed the user-facing label). Server-side fetches the existing
// visa row (or returns "exists: false" with a readonly snapshot). When the
// row doesn't exist yet the client shell POSTs to create it on mount.
interface AccessState { paid: boolean; processing: boolean; payInvoiceId: string | null }

export default async function StudentVisaSectionPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/student/documents');

  // Piece #4 payment gate — render the calm gate (not a raw error toast) when
  // locked, BEFORE the form shell fetches/creates against the payment-gated
  // visa endpoint. Fail-safe: any error → locked. Server-side 403 stays intact.
  let access: AccessState = { paid: false, processing: false, payInvoiceId: null };
  try {
    access = await apiServer.get<AccessState>('/portal/me/access');
  } catch {
    /* fail-safe: locked */
  }
  if (!access.paid) {
    const awaitingSignature = !access.payInvoiceId && !access.processing;
    const payHref = access.payInvoiceId
      ? `/portal/case/pay?invoiceId=${access.payInvoiceId}`
      : '/portal/case';
    return <PaymentGatePanel processing={access.processing} awaitingSignature={awaitingSignature} payHref={payHref} />;
  }

  let initialData:
    | {
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
        employmentEntries: res.employmentEntries ?? [],
        unemploymentEntries: res.unemploymentEntries ?? [],
        partner: res.partner ?? null,
        formerPartners: res.formerPartners ?? [],
        children: res.children ?? [],
        parents: res.parents ?? [],
        siblings: res.siblings ?? [],
        nzContacts: res.nzContacts ?? [],
      };
    }
  } catch {
    // No admission row yet, or other transient error — the shell will surface
    // the failure on mount.
  }

  return <VisaFormShell initialData={initialData} />;
}
