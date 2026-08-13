import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, CreditCard, Landmark, Globe, ExternalLink, ShieldCheck, Check, Clock, CheckCircle2 } from 'lucide-react';
import { apiServer } from '@/lib/apiServer';
import { formatMoneyCents } from '@/lib/money';
import { PayInvoiceButton } from '@/components/portal/PayInvoiceButton';
import { InvoicePdfButton } from '@/components/portal/InvoicePdfButton';
import { CopyButton } from '@/components/portal/CopyButton';
import { ReceiptUpload } from '@/components/portal/ReceiptUpload';

// Client "choose how to pay" screen for one unpaid account-opening invoice.
//
// Server component: server-fetches GET /portal/me/invoices/:invoiceId/pay-options
// (ownership resolved from the JWT — a foreign invoiceId returns 404). Presents
// THREE payment methods; it does NOT change the invoice, upload receipts, or gate
// anything. Amounts stay Latin (formatMoneyCents); copy is keyed via casePay.*.

interface PayOptions {
  invoiceId:      string;
  invoiceNumber:  string;
  currency:       string;
  baseCents:      number;   // the fee before GST
  gstCents:       number;
  bankCents:      number;   // base + GST — what a bank transfer pays
  surchargeCents: number;   // Stripe's cut, card only
  cardCents:      number;   // base + GST + card fee
  clientName:     string | null;
  paid:           boolean;
  processing:     boolean;
  receiptMethod:  string | null;
  bank: {
    bankName:      string;
    bankAddress:   string;
    accountName:   string;
    accountNumber: string;
    swift:         string;
  };
}

const REBIT_URL = 'https://my.rebitmoney.com/auth/register?code=SORENA';

export default async function PayPage({
  searchParams,
}: {
  searchParams: { invoiceId?: string };
}) {
  const t = await getTranslations('casePay');
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
      <ArrowLeft size={16} className="rtl:rotate-180" />
      {t('backToCase')}
    </Link>
  );

  if (!invoiceId || loadError || !opts) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {backLink}
        <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-[#4A4A4A]/75">{t('loadError')}</p>
        </section>
      </div>
    );
  }

  // Display-only: hide the raw ENG-<caseId> id. The account-opening invoice reads
  // as a friendly label; any other invoice keeps its number.
  const invoiceLabel = opts.invoiceNumber.startsWith('ENG-')
    ? t('engagementFee')
    : t('engagementInvoice', { number: opts.invoiceNumber });

  if (opts.paid) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {backLink}
        <section className="rounded-2xl border border-sorena-jade/40 bg-[#f4faf7] p-6 shadow-sm ring-1 ring-sorena-jade/10 md:p-7">
          <div className="flex items-center gap-2.5">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-sorena-jade/15">
              <CheckCircle2 size={22} className="text-sorena-jade" />
            </div>
            <h1 className="text-xl font-bold leading-tight text-[#1e3a5f]">{t('paidTitle')}</h1>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[#4A4A4A]/80">{t('paidBody')}</p>
          <p className="mt-3 text-xs text-[#4A4A4A]/55">
            {invoiceLabel} · {formatMoneyCents(opts.bankCents, opts.currency)}
          </p>
          {/* PR-TAX-INVOICE — the settled document, which prints PAID on its face. */}
          <div className="mt-4">
            <InvoicePdfButton
              invoiceId={opts.invoiceId}
              invoiceNumber={opts.invoiceNumber}
              label={t('taxInvoice')}
            />
          </div>
        </section>
      </div>
    );
  }

  if (opts.processing) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {backLink}
        <section className="rounded-2xl border border-[#c9a961]/40 bg-[#faf8f3] p-6 shadow-sm ring-1 ring-[#c9a961]/10 md:p-7">
          <div className="flex items-center gap-2.5">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[#c9a961]/20">
              <Clock size={22} className="text-[#b28f4e]" />
            </div>
            <h1 className="text-xl font-bold leading-tight text-[#1e3a5f]">{t('processingTitle')}</h1>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[#4A4A4A]/80">{t('processingBody')}</p>
          <p className="mt-3 text-xs text-[#4A4A4A]/55">
            {invoiceLabel} · {formatMoneyCents(opts.bankCents, opts.currency)}
          </p>
        </section>
      </div>
    );
  }

  const hasClientName = opts.clientName !== null;
  const nameForBank = opts.clientName ?? t('yourFullName');
  const feeLabel = formatMoneyCents(opts.surchargeCents, opts.currency);

  const bankRows: Array<{ label: string; value: string; copy: boolean }> = [
    { label: t('bank.bank'),          value: opts.bank.bankName, copy: true },
    { label: t('bank.address'),       value: opts.bank.bankAddress, copy: true },
    { label: t('bank.accountName'),   value: opts.bank.accountName, copy: true },
    { label: t('bank.accountNumber'), value: opts.bank.accountNumber, copy: true },
    { label: t('bank.swift'),         value: opts.bank.swift, copy: true },
    { label: t('bank.particular'),    value: nameForBank, copy: hasClientName },
    { label: t('bank.code'),          value: t('bank.codeHint'), copy: false },
    { label: t('bank.reference'),     value: nameForBank, copy: hasClientName },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {backLink}

      {/* ── Reassuring header ─────────────────────────────────────────── */}
      <header className="flex items-start gap-3.5">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[#c9a961]/15">
          <ShieldCheck size={22} className="text-[#b28f4e]" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight text-[#1e3a5f]">{t('title')}</h1>
          <p className="mt-1 text-sm leading-relaxed text-[#4A4A4A]/80">{t('secure')}</p>
          <p className="mt-2 text-xs text-[#4A4A4A]/55">
            {invoiceLabel} · {formatMoneyCents(opts.bankCents, opts.currency)}
          </p>
          {/* PR-TAX-INVOICE — same document, stating what is still owed. Useful to
              a client who has to forward it to whoever is actually paying. */}
          <div className="mt-3">
            <InvoicePdfButton
              invoiceId={opts.invoiceId}
              invoiceNumber={opts.invoiceNumber}
              label={t('taxInvoice')}
              variant="subtle"
            />
          </div>
        </div>
      </header>

      {/* ── Option 1 — Card (Stripe) ──────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:p-7">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1e3a5f]/8">
            <CreditCard size={18} className="text-[#1e3a5f]" />
          </div>
          <h2 className="text-base font-bold text-[#1e3a5f]">{t('payByCard')}</h2>
        </div>
        <p className="mt-4 text-3xl font-bold tracking-tight text-[#1e3a5f]">
          {formatMoneyCents(opts.cardCents, opts.currency)}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-[#4A4A4A]/75">
          {t('cardFeeNote', { fee: feeLabel })}
        </p>
        <div className="mt-5">
          <PayInvoiceButton
            invoiceId={opts.invoiceId}
            label={t('payByCardAmount', { amount: formatMoneyCents(opts.cardCents, opts.currency) })}
          />
        </div>
      </section>

      {/* ── Option 2 — Bank transfer, HERO (recommended) ──────────────── */}
      <section className="relative overflow-hidden rounded-2xl border border-[#c9a961]/40 border-s-4 border-s-[#c9a961] bg-[#faf8f3] p-6 shadow-sm ring-1 ring-[#c9a961]/10 md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#c9a961]/20">
              <Landmark size={18} className="text-[#b28f4e]" />
            </div>
            <h2 className="text-base font-bold text-[#1e3a5f]">{t('payByBank')}</h2>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#c9a961]/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#8a6d10] whitespace-nowrap">
            <Check size={11} strokeWidth={3} /> {t('recommended')}
          </span>
        </div>
        <p className="mt-4 text-3xl font-bold tracking-tight text-[#1e3a5f]">
          {formatMoneyCents(opts.bankCents, opts.currency)}
        </p>

        <dl className="mt-5 overflow-hidden rounded-xl border border-[#c9a961]/20 bg-white divide-y divide-gray-100">
          {bankRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{row.label}</dt>
                <dd className="mt-0.5 break-words select-all font-mono text-[13px] font-medium text-[#1e3a5f]">
                  {row.value}
                </dd>
              </div>
              {row.copy && <CopyButton value={row.value} label={row.label} />}
            </div>
          ))}
        </dl>

        <p className="mt-4 text-xs leading-relaxed text-[#4A4A4A]/60">{t('processingTimes')}</p>

        <div className="mt-4 border-t border-[#c9a961]/20 pt-4">
          <p className="text-sm font-semibold text-[#1e3a5f]">{t('alreadyPaidBank')}</p>
          <ReceiptUpload invoiceId={opts.invoiceId} method="bank" />
        </div>
      </section>

      {/* ── Option 3 — Partner exchange (Rebit) ───────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 md:p-7">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100">
            <Globe size={18} className="text-[#1e3a5f]/70" />
          </div>
          <h2 className="text-base font-bold text-[#1e3a5f]">{t('cantPay')}</h2>
        </div>
        <p className="mt-4 text-3xl font-bold tracking-tight text-[#1e3a5f]">
          {formatMoneyCents(opts.bankCents, opts.currency)}
        </p>
        <p className="mt-2.5 text-sm leading-relaxed text-[#4A4A4A]/75">{t('partnerIntro')}</p>
        <a
          href={REBIT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#1e3a5f]/25 px-5 py-2.5 text-sm font-semibold text-[#1e3a5f] transition-colors hover:bg-[#1e3a5f]/5"
        >
          <ExternalLink size={16} />
          {t('payViaPartner')}
        </a>

        <div className="mt-4 border-t border-gray-100 pt-4">
          <p className="text-sm font-semibold text-[#1e3a5f]">{t('alreadyPaidPartner')}</p>
          <ReceiptUpload invoiceId={opts.invoiceId} method="exchange" />
        </div>
      </section>
    </div>
  );
}
