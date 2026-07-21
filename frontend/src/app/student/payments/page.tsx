import { CreditCard } from 'lucide-react';
import { apiServer } from '@/lib/apiServer';
import { StudentHeader } from '@/components/student/StudentHeader';
import { PayInvoiceButton } from '@/components/portal/PayInvoiceButton';

// Client payment history & receipts. Read-only history via GET
// /portal/me/payments, PLUS any outstanding invoice surfaced above it with a
// Pay-now button that reuses the SAME checkout the My Case page uses
// (POST /portal/me/invoices/:id/pay-link → Stripe). Strings are hardcoded
// English to match this page's existing convention.

interface MeResponse {
  fullName: string;
  photoUrl: string | null;
}

interface PaymentRow {
  id:            string;
  createdAt:     string;
  amountCents:   number;
  currency:      string;
  status:        string;
  label:         string;
  invoiceNumber?: string;
}

interface InvoiceRow {
  id:            string;
  invoiceNumber: string;
  description:   string | null;
  amount:        string | number;
  currency:      string;
  status:        string;
  dueDate:       string | null;
}

// Invoice states the client can still pay (mirrors the pay-link endpoint's
// SENT/OVERDUE guard). PARTIAL/DRAFT/PAID/CANCELLED are not offered here.
const PAYABLE_STATUSES = ['SENT', 'OVERDUE'];

// DD/MM/YYYY
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB').format(new Date(iso));
}

// Cents → "NZD 150.00" (payment history rows carry cents)
function formatAmount(cents: number, currency: string): string {
  return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
}

// Invoice amount is a decimal in major units (dollars) → "USD 200.00"
function formatInvoiceAmount(amount: string | number, currency: string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return `${currency.toUpperCase()} ${num.toFixed(2)}`;
}

// Stripe status → human. All rows are successful charges (the Payment table
// records payment_intent.succeeded events), so this reads "Paid".
function humanStatus(status: string): string {
  if (status === 'succeeded') return 'Paid';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

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

  // Outstanding invoices — the piece that used to be missing, making this a
  // dead end. Failure is non-fatal: an invoice-fetch hiccup just hides the
  // outstanding section, leaving history intact.
  let outstanding: InvoiceRow[] = [];
  try {
    const invoices = await apiServer.get<InvoiceRow[]>('/students/me/invoices');
    outstanding = invoices.filter((inv) => PAYABLE_STATUSES.includes(inv.status));
  } catch {
    /* no outstanding section on error */
  }

  return (
    <div>
      <StudentHeader
        name={me.fullName}
        photoUrl={me.photoUrl}
        subtitle="Your payments."
        showBack
      />

      {/* Outstanding — shown above history, with the same Pay-now checkout used
          on the My Case page. */}
      {outstanding.length > 0 && (
        <section className="mb-6 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#4A4A4A]/60">
            Outstanding
          </h2>
          {outstanding.map((inv) => (
            <div
              key={inv.id}
              className="flex flex-col gap-3 rounded-2xl border border-orange-200 bg-orange-50/60 p-4 md:flex-row md:items-center md:justify-between md:p-5"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#1e3a5f]">
                  {inv.invoiceNumber?.startsWith('ENG-')
                    ? 'Engagement fee'
                    : inv.description || `Invoice ${inv.invoiceNumber}`}
                </p>
                <p className="text-xs text-[#4A4A4A]/70 mt-0.5">
                  {formatInvoiceAmount(inv.amount, inv.currency)}
                  {inv.dueDate ? ` · due ${formatDate(inv.dueDate)}` : ''}
                </p>
              </div>
              <PayInvoiceButton invoiceId={inv.id} label="Pay now" />
            </div>
          ))}
        </section>
      )}

      {loadError ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-[#4A4A4A]/70">
            We couldn&apos;t load your payments right now. Please refresh.
          </p>
        </div>
      ) : payments.length > 0 ? (
        <ul className="space-y-3">
          {payments.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-4 md:p-5 min-h-[64px]"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#1e3a5f] truncate">{p.label}</p>
                <p className="text-xs text-[#4A4A4A]/60 mt-0.5">{formatDate(p.createdAt)}</p>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-sm font-bold text-[#1e3a5f]">
                  {formatAmount(p.amountCents, p.currency)}
                </p>
                <span className="mt-1 inline-block rounded-full bg-[#c9a961]/15 px-2 py-0.5 text-[11px] font-semibold text-[#8a6d10]">
                  {humanStatus(p.status)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : outstanding.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#1e3a5f]/15 bg-[#faf8f3] p-10 text-center">
          <CreditCard size={28} className="mx-auto text-[#c9a961] mb-3" />
          <p className="text-[#1e3a5f] font-semibold">No payments yet</p>
          <p className="text-sm text-[#4A4A4A]/60 mt-1">
            Your payments and receipts will appear here once you&apos;ve made one.
          </p>
        </div>
      ) : (
        <p className="text-sm text-[#4A4A4A]/60 px-1">No completed payments yet.</p>
      )}
    </div>
  );
}
