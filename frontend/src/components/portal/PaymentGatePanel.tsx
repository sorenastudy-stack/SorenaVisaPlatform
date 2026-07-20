import Link from 'next/link';
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

export function PaymentGatePanel({
  processing = false,
  awaitingSignature = false,
  payHref = '/portal/case',
}: {
  processing?: boolean;
  awaitingSignature?: boolean;
  payHref?: string;
}) {
  if (awaitingSignature) {
    return (
      <section className="mx-auto max-w-2xl rounded-2xl border border-[#c9a961]/40 bg-[#faf8f3] p-6 text-center shadow-sm ring-1 ring-[#c9a961]/10 md:p-10">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#c9a961]/20">
          <Mail size={26} className="text-[#b8941f]" />
        </div>
        <h1 className="text-xl font-bold leading-tight text-[#1e3a5f] md:text-2xl">
          Sign your engagement letter first
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#4A4A4A]/80">
          We&apos;ve emailed you the engagement letter to review and sign. Once it&apos;s signed,
          your payment opens here automatically — there&apos;s nothing to pay until then.
        </p>
        <Link
          href="/portal/case"
          className="mt-6 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#1e3a5f]/25 px-5 py-2.5 text-sm font-semibold text-[#1e3a5f] transition-colors hover:bg-[#1e3a5f]/5"
        >
          Back to My Case
          <ArrowRight size={16} />
        </Link>
      </section>
    );
  }

  if (processing) {
    return (
      <section className="mx-auto max-w-2xl rounded-2xl border border-[#c9a961]/40 bg-[#faf8f3] p-6 shadow-sm ring-1 ring-[#c9a961]/10 md:p-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[#c9a961]/20">
            <Clock size={22} className="text-[#b8941f]" />
          </div>
          <h1 className="text-xl font-bold leading-tight text-[#1e3a5f]">
            Payment received — we&apos;re confirming it
          </h1>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-[#4A4A4A]/80">
          Thanks — we&apos;ve got your receipt. We&apos;ll confirm once the funds land, usually within
          a few business days, and your full access opens automatically then. Nothing more to do
          for now.
        </p>
        <Link
          href={payHref}
          className="mt-5 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#1e3a5f]/25 px-5 py-2.5 text-sm font-semibold text-[#1e3a5f] transition-colors hover:bg-[#1e3a5f]/5"
        >
          View my case
          <ArrowRight size={16} />
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
        Your full access opens once we confirm your payment
      </h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#4A4A4A]/80">
        To keep your application moving, your documents and forms unlock as soon as your engagement
        payment is confirmed. You can still see your case status and complete your payment now — it
        only takes a moment.
      </p>
      <Link
        href={payHref}
        className="mt-6 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#162d4a]"
      >
        Go to payment
        <ArrowRight size={16} />
      </Link>
    </section>
  );
}
