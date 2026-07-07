import Link from 'next/link';
import { ArrowLeft, CreditCard, Landmark, Globe, ExternalLink, ShieldCheck, Check, Clock } from 'lucide-react';
import { apiServer } from '@/lib/apiServer';
import { PayInvoiceButton } from '@/components/portal/PayInvoiceButton';
import { CopyButton } from '@/components/portal/CopyButton';
import { ReceiptUpload } from '@/components/portal/ReceiptUpload';

// Client "choose how to pay" screen for one unpaid engagement invoice.
//
// Server component: server-fetches GET /portal/me/invoices/:invoiceId/pay-options
// (ownership resolved from the JWT — a foreign invoiceId returns 404). Presents
// THREE payment methods; it does NOT change the invoice, upload receipts, or
// gate anything. The card total ($220) is derived server-side (base + surcharge);
// bank / partner-exchange pay the base ($200). Strings are hardcoded English to
// match the surrounding /portal pages (which are hardcoded too).

interface PayOptions {
  invoiceId:      string;
  invoiceNumber:  string;
  currency:       string;
  baseCents:      number;
  surchargeCents: number;
  cardCents:      number;
  clientName:     string | null;
  processing:     boolean;
  receiptMethod:  string | null;
}

const REBIT_URL = 'https://my.rebitmoney.com/auth/register?code=SORENA';

function money(cents: number, currency: string): string {
  return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
}

export default async function PayPage({
  searchParams,
}: {
  searchParams: { invoiceId?: string };
}) {
  const invoiceId = searchParams.invoiceId;

  let opts: PayOptions | null = null;
  let loadError = false;
  if (invoiceId) {
    try {
      opts = await apiServer.get<PayOptions>(`/portal/me/invoices/${invoiceId}/pay-options`);
    } catch {
      loadError = true;
    }
  }

  const backLink = (
    <Link
      href="/portal/case"
      className="inline-flex items-center gap-1.5 text-sm text-[#1e3a5f]/70 hover:text-[#1e3a5f] transition-colors"
    >
      <ArrowLeft size={16} />
      Back to my case
    </Link>
  );

  if (!invoiceId || loadError || !opts) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {backLink}
        <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-[#4A4A4A]/75">
            We couldn&apos;t load your payment options. Please go back to your case and try again.
          </p>
        </section>
      </div>
    );
  }

  // Piece #2 — a receipt has been uploaded: replace the payment methods with a
  // calm "we're confirming it" state (the invoice is NOT paid yet — an
  // accountant confirms later).
  if (opts.processing) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {backLink}
        <section className="rounded-2xl border border-[#c9a961]/40 bg-[#faf8f3] p-6 shadow-sm ring-1 ring-[#c9a961]/10 md:p-7">
          <div className="flex items-center gap-2.5">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[#c9a961]/20">
              <Clock size={22} className="text-[#b8941f]" />
            </div>
            <h1 className="text-xl font-bold leading-tight text-[#1e3a5f]">
              Payment received — we&apos;re confirming it
            </h1>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[#4A4A4A]/80">
            Thanks — we&apos;ve got your receipt. We&apos;ll confirm once the funds land, usually
            within a few business days. Your full access opens then.
          </p>
          <p className="mt-3 text-xs text-[#4A4A4A]/55">
            Engagement invoice {opts.invoiceNumber} · {money(opts.baseCents, opts.currency)}
          </p>
        </section>
      </div>
    );
  }

  const hasClientName = opts.clientName !== null;
  const nameForBank = opts.clientName ?? 'your full name';
  const feeLabel = `$${(opts.surchargeCents / 100).toFixed(0)}`;

  // Only real values get a copy button — never the guidance placeholders.
  const bankRows: Array<{ label: string; value: string; copy: boolean }> = [
    { label: 'Bank',           value: 'Kiwibank', copy: true },
    { label: 'Bank Address',   value: 'Kiwibank Limited, Level 9, 20 Customhouse Quay, Wellington, 6011, New Zealand', copy: true },
    { label: 'Account Name',   value: 'SORENASTUDY LIMITED', copy: true },
    { label: 'Account Number', value: '38-9022-0355698-01', copy: true },
    { label: 'SWIFT Code',     value: 'KIWINZ22', copy: true },
    { label: 'Particular',     value: nameForBank, copy: hasClientName },
    { label: 'Code',           value: 'Your Client ID (leave blank if new)', copy: false },
    { label: 'Reference',      value: nameForBank, copy: hasClientName },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {backLink}

      {/* ── Reassuring header ─────────────────────────────────────────── */}
      <header className="flex items-start gap-3.5">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[#c9a961]/15">
          <ShieldCheck size={22} className="text-[#b8941f]" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight text-[#1e3a5f]">Complete your payment</h1>
          <p className="mt-1 text-sm leading-relaxed text-[#4A4A4A]/80">
            Your payment is secure. Your full access opens once we&apos;ve confirmed your payment.
          </p>
          <p className="mt-2 text-xs text-[#4A4A4A]/55">
            Engagement invoice {opts.invoiceNumber} · {money(opts.baseCents, opts.currency)}
          </p>
        </div>
      </header>

      {/* ── Option 1 — Card (Stripe), neutral ─────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:p-7">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1e3a5f]/8">
            <CreditCard size={18} className="text-[#1e3a5f]" />
          </div>
          <h2 className="text-base font-bold text-[#1e3a5f]">Pay by card</h2>
        </div>
        <p className="mt-4 text-3xl font-bold tracking-tight text-[#1e3a5f]">
          {money(opts.cardCents, opts.currency)}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-[#4A4A4A]/75">
          Includes a {feeLabel} card processing fee. Prefer to avoid it? Pay by bank transfer below.
        </p>
        <div className="mt-5">
          <PayInvoiceButton
            invoiceId={opts.invoiceId}
            label={`Pay ${money(opts.cardCents, opts.currency)} by card`}
          />
        </div>
      </section>

      {/* ── Option 2 — Bank transfer, HERO (gold accent, recommended) ─── */}
      <section className="relative overflow-hidden rounded-2xl border border-[#c9a961]/40 border-l-4 border-l-[#c9a961] bg-[#faf8f3] p-6 shadow-sm ring-1 ring-[#c9a961]/10 md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#c9a961]/20">
              <Landmark size={18} className="text-[#b8941f]" />
            </div>
            <h2 className="text-base font-bold text-[#1e3a5f]">Pay by bank transfer</h2>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#c9a961]/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#8a6d10] whitespace-nowrap">
            <Check size={11} strokeWidth={3} /> Recommended · no fee
          </span>
        </div>
        <p className="mt-4 text-3xl font-bold tracking-tight text-[#1e3a5f]">
          {money(opts.baseCents, opts.currency)}
        </p>

        <dl className="mt-5 overflow-hidden rounded-xl border border-[#c9a961]/20 bg-white divide-y divide-gray-100">
          {bankRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {row.label}
                </dt>
                <dd className="mt-0.5 break-words select-all font-mono text-[13px] font-medium text-[#1e3a5f]">
                  {row.value}
                </dd>
              </div>
              {row.copy && <CopyButton value={row.value} label={row.label} />}
            </div>
          ))}
        </dl>

        <p className="mt-4 text-xs leading-relaxed text-[#4A4A4A]/60">
          Please note that payment processing times vary by method: card payments typically clear to
          our account within 4–7 business days, while international bank transfers can take anywhere
          from 1 to 10 business days depending on your bank — your booking is confirmed once the funds
          have settled.
        </p>

        <div className="mt-4 border-t border-[#c9a961]/20 pt-4">
          <p className="text-sm font-semibold text-[#1e3a5f]">Already paid by bank transfer?</p>
          <ReceiptUpload invoiceId={opts.invoiceId} method="bank" />
        </div>
      </section>

      {/* ── Option 3 — Partner exchange (Rebit), lightest ─────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 md:p-7">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100">
            <Globe size={18} className="text-[#1e3a5f]/70" />
          </div>
          <h2 className="text-base font-bold text-[#1e3a5f]">Can&apos;t pay by card or bank transfer?</h2>
        </div>
        <p className="mt-4 text-3xl font-bold tracking-tight text-[#1e3a5f]">
          {money(opts.baseCents, opts.currency)}
        </p>
        <p className="mt-2.5 text-sm leading-relaxed text-[#4A4A4A]/75">
          If card or bank transfer isn&apos;t available in your region, you can send your payment
          securely through our partner exchange service using this link:
        </p>
        <a
          href={REBIT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#1e3a5f]/25 px-5 py-2.5 text-sm font-semibold text-[#1e3a5f] transition-colors hover:bg-[#1e3a5f]/5"
        >
          <ExternalLink size={16} />
          Pay via partner exchange
        </a>

        <div className="mt-4 border-t border-gray-100 pt-4">
          <p className="text-sm font-semibold text-[#1e3a5f]">Already paid via partner exchange?</p>
          <ReceiptUpload invoiceId={opts.invoiceId} method="exchange" />
        </div>
      </section>
    </div>
  );
}
