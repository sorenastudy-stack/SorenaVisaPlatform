'use client';

import { CreditCard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PayInvoiceButton } from '@/components/portal/PayInvoiceButton';
import { InvoicePdfButton } from '@/components/portal/InvoicePdfButton';
import { formatMoney, formatMoneyCents } from '@/lib/money';
import { formatDate } from '@/lib/date';
import { useLocaleStore } from '@/lib/stores/localeStore';

// PR-PORTAL-PAYMENTS — shared, read-only payments view used by both the /portal
// (LEAD) and /student (STUDENT) Payments pages. Pure presentation: the page
// fetches the caller's OWN data (GET /portal/me/payments + /portal/me/invoices)
// and passes it in. Outstanding invoices carry the SAME Pay-now checkout used on
// My Case (POST /portal/me/invoices/:id/pay-link) — no finance/verification logic
// is duplicated here; this only surfaces status.
//
// I18N (Phase 30): a client component so copy comes from t('paymentsView.*'); money
// stays LATIN via formatMoney/formatMoneyCents (locked "NZD 1,200.00"); dates
// localise via formatDate(iso, locale) (Gregorian, Persian months + digits).

export interface PaymentRow {
  id: string; createdAt: string; amountCents: number; currency: string;
  status: string; label: string; invoiceNumber?: string;
}
export interface InvoiceRow {
  id: string; invoiceNumber: string; description: string | null;
  /** PRE-GST base. Never render this as the price — see totalCents. */
  amount: string | number; currency: string; status: string; dueDate: string | null;
  /** base + GST — what the client owes. Optional so an older payload still renders. */
  gstCents?: number; totalCents?: number;
}

// PAYABLE_STATUSES lives in lib/invoice-status — import it from there.
//
// It is deliberately NOT re-exported here. A re-export from a 'use client'
// module is indistinguishable, at the import site, from the original export
// that caused the bug: a Server Component writing
// `import { PaymentsView, PAYABLE_STATUSES } from './PaymentsView'` would
// receive a client reference again, `.includes()` would throw, and the nearby
// catch would swallow it exactly as before. The compatibility re-export that
// used to sit here had no remaining callers and was removed to close that door.

export function PaymentsView({
  payments, outstanding, invoices = [], loadError = false,
}: {
  payments: PaymentRow[];
  outstanding: InvoiceRow[];
  /**
   * PR-TAX-INVOICE — every invoice, including settled ones. `outstanding` is a
   * filtered subset, and a PAID invoice is precisely the document a client wants
   * to keep, so the download needs the unfiltered list. Optional so a caller
   * that has not been updated still renders exactly as before.
   */
  invoices?: InvoiceRow[];
  loadError?: boolean;
}) {
  const t = useTranslations('paymentsView');
  const locale = useLocaleStore((s) => s.locale);

  // A payment row knows its invoice NUMBER, not its id, and the PDF route is
  // keyed by id. Resolve one to the other; a charge with no matching invoice
  // (older data) simply shows no download rather than a broken button.
  const invoiceByNumber = new Map(invoices.map((inv) => [inv.invoiceNumber, inv]));

  // Stripe status → human. Payment rows are succeeded charges; a bank/exchange
  // receipt awaiting Finance shows on the invoice as still-outstanding (below).
  // Known statuses translate; anything unexpected falls back to the raw label.
  const humanStatus = (status: string): string => {
    const key = status === 'succeeded' ? 'paid' : status.toLowerCase();
    return t.has(`status.${key}`) ? t(`status.${key}`) : status.charAt(0).toUpperCase() + status.slice(1);
  };

  return (
    <div>
      {/* Outstanding — shown above history, with the same Pay-now checkout. */}
      {outstanding.length > 0 && (
        <section className="mb-6 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#4A4A4A]/60">{t('outstanding')}</h2>
          {outstanding.map((inv) => (
            <div
              key={inv.id}
              className="flex flex-col gap-3 rounded-2xl border border-orange-200 bg-orange-50/60 p-4 md:flex-row md:items-center md:justify-between md:p-5"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#1e3a5f]">
                  {inv.invoiceNumber?.startsWith('ENG-') ? t('accountOpeningFee') : inv.description || t('invoiceFallback', { number: inv.invoiceNumber })}
                </p>
                <p className="mt-0.5 text-xs text-[#4A4A4A]/70">
                  {/* The amount owed, not the pre-GST base: this line read
                      "USD 200.00" beside a USD 230.00 invoice. */}
                  {inv.totalCents != null
                    ? formatMoneyCents(inv.totalCents, inv.currency)
                    : formatMoney(typeof inv.amount === 'string' ? parseFloat(inv.amount) : inv.amount, inv.currency)}
                  {inv.dueDate ? ` · ${t('due', { date: formatDate(inv.dueDate, locale) })}` : ''}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <InvoicePdfButton
                  invoiceId={inv.id}
                  invoiceNumber={inv.invoiceNumber}
                  label={t('taxInvoice')}
                  variant="subtle"
                />
                <PayInvoiceButton invoiceId={inv.id} />
              </div>
            </div>
          ))}
        </section>
      )}

      {loadError ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-[#4A4A4A]/70">{t('loadError')}</p>
        </div>
      ) : payments.length > 0 ? (
        <ul className="space-y-3">
          {payments.map((p) => (
            <li key={p.id} className="flex min-h-[64px] items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-4 md:p-5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#1e3a5f]">{p.label}</p>
                <p className="mt-0.5 text-xs text-[#4A4A4A]/60">{formatDate(p.createdAt, locale)}</p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-bold text-[#1e3a5f]">{formatMoneyCents(p.amountCents, p.currency)}</p>
                  <span className="mt-1 inline-block rounded-full bg-[#c9a961]/15 px-2 py-0.5 text-[11px] font-semibold text-[#8a6d10]">{humanStatus(p.status)}</span>
                </div>
                {p.invoiceNumber && invoiceByNumber.has(p.invoiceNumber) && (
                  <InvoicePdfButton
                    invoiceId={invoiceByNumber.get(p.invoiceNumber)!.id}
                    invoiceNumber={p.invoiceNumber}
                    label={t('taxInvoice')}
                    variant="subtle"
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : outstanding.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#1e3a5f]/15 bg-[#faf8f3] p-10 text-center">
          <CreditCard size={28} className="mx-auto mb-3 text-[#c9a961]" />
          <p className="font-semibold text-[#1e3a5f]">{t('emptyTitle')}</p>
          <p className="mt-1 text-sm text-[#4A4A4A]/60">{t('emptyBody')}</p>
        </div>
      ) : (
        <p className="px-1 text-sm text-[#4A4A4A]/60">{t('emptyCompleted')}</p>
      )}
    </div>
  );
}
