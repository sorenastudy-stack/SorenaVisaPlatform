import { CreditCard } from 'lucide-react';
import { apiServer } from '@/lib/apiServer';
import { StudentHeader } from '@/components/student/StudentHeader';

// Client payment history & receipts. Read-only: server-fetches the caller's
// OWN payments via GET /portal/me/payments (LEAD/STUDENT-gated, ownership
// resolved server-side from the JWT — no client-supplied id). Strings are
// hardcoded English to match this page's existing convention (the prior stub
// + StudentHeader subtitle were hardcoded too — no lone i18n call).

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

// DD/MM/YYYY
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB').format(new Date(iso));
}

// Cents → "NZD 150.00"
function formatAmount(cents: number, currency: string): string {
  return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
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

  return (
    <div>
      <StudentHeader
        name={me.fullName}
        photoUrl={me.photoUrl}
        subtitle="Your payment history."
        showBack
      />

      {loadError ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-[#4A4A4A]/70">
            We couldn&apos;t load your payments right now. Please refresh.
          </p>
        </div>
      ) : payments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#1e3a5f]/15 bg-[#faf8f3] p-10 text-center">
          <CreditCard size={28} className="mx-auto text-[#c9a961] mb-3" />
          <p className="text-[#1e3a5f] font-semibold">No payments yet</p>
          <p className="text-sm text-[#4A4A4A]/60 mt-1">
            Your payments and receipts will appear here once you&apos;ve made one.
          </p>
        </div>
      ) : (
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
      )}
    </div>
  );
}
