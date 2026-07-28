import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Lock, Clock, ArrowRight, Mail } from 'lucide-react';

// Piece #4 — the calm "full access opens once we confirm your payment" gate.
//
// Rendered in place of a locked surface (e.g. Documents) when the client's
// engagement fee isn't PAID yet. Three tones:
//   • awaitingSignature — no engagement invoice exists yet (the fee is raised
//     only AFTER the client signs). Honest "sign first" state; NO pay button
//     (there's nothing to pay, and the old fallback looped back to My Case).
//   • processing        — a receipt is uploaded, awaiting confirmation: a
//     reassuring "we're confirming it" state (from Piece #2), NOT a dead end.
//   • locked (default)  — an invoice exists, unpaid: guide them to the pay screen.
// No dark patterns: plain language, one clear action (or none when there's
// nothing to do yet).
//
// I18N (Phase 30): async server component so it can pull copy via
// getTranslations('paymentGate'). "engagement letter" → «قرارداد همکاری» (the
// contract, matching portal.contractReady); the locked-state payment aligns to
// the account-opening fee terminology («افتتاح اکانت»).

export async function PaymentGatePanel({
  processing = false,
  awaitingSignature = false,
  payHref = '/portal/case',
}: {
  processing?: boolean;
  awaitingSignature?: boolean;
  payHref?: string;
}) {
  const t = await getTranslations('paymentGate');

  if (awaitingSignature) {
    return (
      <section className="mx-auto max-w-2xl rounded-2xl border border-[#c9a961]/40 bg-[#faf8f3] p-6 text-center shadow-sm ring-1 ring-[#c9a961]/10 md:p-10">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#c9a961]/20">
          <Mail size={26} className="text-[#b28f4e]" />
        </div>
        <h1 className="text-xl font-bold leading-tight text-[#1e3a5f] md:text-2xl">
          {t('awaitingSignature.title')}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#4A4A4A]/80">
          {t('awaitingSignature.body')}
        </p>
        <Link
          href="/portal/case"
          className="mt-6 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#1e3a5f]/25 px-5 py-2.5 text-sm font-semibold text-[#1e3a5f] transition-colors hover:bg-[#1e3a5f]/5"
        >
          {t('awaitingSignature.action')}
          <ArrowRight size={16} className="rtl:rotate-180" />
        </Link>
      </section>
    );
  }

  if (processing) {
    return (
      <section className="mx-auto max-w-2xl rounded-2xl border border-[#c9a961]/40 bg-[#faf8f3] p-6 shadow-sm ring-1 ring-[#c9a961]/10 md:p-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[#c9a961]/20">
            <Clock size={22} className="text-[#b28f4e]" />
          </div>
          <h1 className="text-xl font-bold leading-tight text-[#1e3a5f]">
            {t('processing.title')}
          </h1>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-[#4A4A4A]/80">
          {t('processing.body')}
        </p>
        <Link
          href={payHref}
          className="mt-5 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#1e3a5f]/25 px-5 py-2.5 text-sm font-semibold text-[#1e3a5f] transition-colors hover:bg-[#1e3a5f]/5"
        >
          {t('processing.action')}
          <ArrowRight size={16} className="rtl:rotate-180" />
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm md:p-10">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1e3a5f]/8">
        <Lock size={26} className="text-[#1e3a5f]" />
      </div>
      <h1 className="text-xl font-bold leading-tight text-[#1e3a5f] md:text-2xl">
        {t('locked.title')}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#4A4A4A]/80">
        {t('locked.body')}
      </p>
      <Link
        href={payHref}
        className="mt-6 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#162d4a]"
      >
        {t('locked.action')}
        <ArrowRight size={16} className="rtl:rotate-180" />
      </Link>
    </section>
  );
}
