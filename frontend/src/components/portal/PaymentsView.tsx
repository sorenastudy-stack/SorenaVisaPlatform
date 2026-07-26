import { CreditCard } from 'lucide-react';
import { PayInvoiceButton } from '@/components/portal/PayInvoiceButton';

// PR-PORTAL-PAYMENTS — shared, read-only payments view used by both the /portal
// (LEAD) and /student (STUDENT) Payments pages. Pure presentation: the page
// fetches the caller's OWN data (GET /portal/me/payments + /portal/me/invoices)
// and passes it in. Outstanding invoices carry the SAME Pay-now checkout used on
// My Case (POST /portal/me/invoices/:id/pay-link) — no finance/verification logic
// is duplicated here; this only surfaces status.

export interface PaymentRow {
  id: string; createdAt: string; amountCents: number; currency: string;
  status: string; label: string; invoiceNumber?: string;
}
export interface InvoiceRow {
  id: string; invoiceNumber: string; description: string | null;
  amount: string | number; currency: string; status: string; dueDate: string | null;
}

// Invoice states the client can still pay (mirrors the pay-link endpoint's guard).
export const PAYABLE_STATUSES = ['SENT', 'OVERDUE'];

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB').format(new Date(iso));
}
function formatAmount(cents: number, currency: string): string {
  return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
}
function formatInvoiceAmount(amount: string | number, currency: string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return `${currency.toUpperCase()} ${num.toFixed(2)}`;
}
// Stripe status → human. Payment rows are succeeded charges; a bank/exchange
// receipt awaiting Finance shows on the invoice as still-outstanding (below).
function humanStatus(status: string): string {
  if (status === 'succeeded') return 'Paid';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function PaymentsView({
  payments, outstanding, loadError = false,
}: {
  payments: PaymentRow[];
  outstanding: InvoiceRow[];
  loadError?: boolean;
}) {
  return (
    <div>
      {/* Outstanding — shown above history, with the same Pay-now checkout. */}
      {outstanding.length > 0 && (
        <section className="mb-6 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#4A4A4A]/60">Outstanding</h2>
          {outstanding.map((inv) => (
            <div
              key={inv.id}
              className="flex flex-col gap-3 rounded-2xl border border-orange-200 bg-orange-50/60 p-4 md:flex-row md:items-center md:justify-between md:p-5"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#1e3a5f]">
                  {inv.invoiceNumber?.startsWith('ENG-') ? 'Engagement fee' : inv.description || `Invoice ${inv.invoiceNumber}`}
                </p>
                <p className="mt-0.5 text-xs text-[#4A4A4A]/70">
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
          <p className="text-sm text-[#4A4A4A]/70">We couldn&apos;t load your payments right now. Please refresh.</p>
        </div>
      ) : payments.length > 0 ? (
        <ul className="space-y-3">
          {payments.map((p) => (
            <li key={p.id} className="flex min-h-[64px] items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-4 md:p-5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#1e3a5f]">{p.label}</p>
                <p className="mt-0.5 text-xs text-[#4A4A4A]/60">{formatDate(p.createdAt)}</p>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-sm font-bold text-[#1e3a5f]">{formatAmount(p.amountCents, p.currency)}</p>
                <span className="mt-1 inline-block rounded-full bg-[#c9a961]/15 px-2 py-0.5 text-[11px] font-semibold text-[#8a6d10]">{humanStatus(p.status)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : outstanding.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#1e3a5f]/15 bg-[#faf8f3] p-10 text-center">
          <CreditCard size={28} className="mx-auto mb-3 text-[#c9a961]" />
          <p className="font-semibold text-[#1e3a5f]">No payments yet</p>
          <p className="mt-1 text-sm text-[#4A4A4A]/60">Your payments and receipts will appear here once you&apos;ve made one.</p>
        </div>
      ) : (
        <p className="px-1 text-sm text-[#4A4A4A]/60">No completed payments yet.</p>
      )}
    </div>
  );
}
