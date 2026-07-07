import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { apiServer } from '@/lib/apiServer';
import { AdmissionFormShell } from '@/components/student/admission/AdmissionFormShell';
import { PaymentGatePanel } from '@/components/portal/PaymentGatePanel';
import type { Application, ProgrammeChoice, EducationEntry, AdmissionDocument } from '@/components/student/admission/AdmissionFormContext';

interface AccessState { paid: boolean; processing: boolean; payInvoiceId: string | null }

export default async function AdmissionPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/student/admission');

  // Piece #4 payment gate — render the calm gate (not a raw error toast) when
  // locked, BEFORE the form shell POST-creates against the payment-gated
  // admission endpoint. Fail-safe: any error → locked. The server-side 403
  // remains the real boundary; this is the client UX layer.
  let access: AccessState = { paid: false, processing: false, payInvoiceId: null };
  try {
    access = await apiServer.get<AccessState>('/portal/me/access');
  } catch {
    /* fail-safe: locked */
  }
  if (!access.paid) {
    const payHref = access.payInvoiceId
      ? `/portal/case/pay?invoiceId=${access.payInvoiceId}`
      : '/portal/case';
    return <PaymentGatePanel processing={access.processing} payHref={payHref} />;
  }

  let initialData: {
    exists: boolean;
    application: Application;
    programmeChoices: ProgrammeChoice[];
    educationEntries: EducationEntry[];
    documents: AdmissionDocument[];
  } | null = null;

  try {
    const res = await apiServer.get<{
      exists: boolean;
      application: Application;
      programmeChoices: ProgrammeChoice[];
      educationEntries: EducationEntry[];
      documents: AdmissionDocument[];
    }>('/students/me/admission/application');
    if (res.exists) initialData = res;
  } catch {
    // no application yet — shell POST-creates on mount
  }

  return <AdmissionFormShell session={session} initialData={initialData} />;
}
