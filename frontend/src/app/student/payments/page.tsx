import { apiServer } from '@/lib/apiServer';
import { StudentHeader } from '@/components/student/StudentHeader';
import { PaymentsView, PAYABLE_STATUSES, type PaymentRow, type InvoiceRow } from '@/components/portal/PaymentsView';

// Client payment history & receipts (STUDENT). Same read-only view as the
// /portal Payments page — shared <PaymentsView>, same own-data endpoints
// (GET /portal/me/payments + /portal/me/invoices). Only the StudentHeader differs.

interface MeResponse { fullName: string; photoUrl: string | null }

export default async function StudentPaymentsPage() {
  let me: MeResponse = { fullName: 'Your Account', photoUrl: null };
  try {
    me = await apiServer.get<MeResponse>('/students/me');
  } catch {
    /* keep fallback */
  }

  let payments: PaymentRow[] = [];
  let loadError = false;
  try {
    payments = await apiServer.get<PaymentRow[]>('/portal/me/payments');
  } catch {
    loadError = true;
  }

  let outstanding: InvoiceRow[] = [];
  try {
    const invoices = await apiServer.get<InvoiceRow[]>('/portal/me/invoices');
    outstanding = invoices.filter((inv) => PAYABLE_STATUSES.includes(inv.status));
  } catch {
    /* non-fatal */
  }

  return (
    <div>
      <StudentHeader name={me.fullName} photoUrl={me.photoUrl} subtitle="Your payments." showBack />
      <PaymentsView payments={payments} outstanding={outstanding} loadError={loadError} />
    </div>
  );
}
