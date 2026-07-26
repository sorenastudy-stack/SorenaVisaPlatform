import { apiServer } from '@/lib/apiServer';
import { PaymentsView, PAYABLE_STATUSES, type PaymentRow, type InvoiceRow } from '@/components/portal/PaymentsView';

// PR-PORTAL-PAYMENTS — client Payments page inside /portal/* (reachable by LEAD
// and STUDENT). Read-only: history via GET /portal/me/payments + outstanding
// invoices via GET /portal/me/invoices, both own-data-scoped server-side. Renders
// inside the shared ClientShell (from /portal/layout).

export default async function PortalPaymentsPage() {
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
    /* non-fatal — hide the outstanding section, keep history */
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <h1 className="mb-1 text-2xl font-bold text-[#1e3a5f]">Payments</h1>
      <p className="mb-6 text-sm text-gray-500">Your account-opening fee and any other charges — and where each stands.</p>
      <PaymentsView payments={payments} outstanding={outstanding} loadError={loadError} />
    </div>
  );
}
