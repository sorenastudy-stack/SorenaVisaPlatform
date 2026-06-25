import { CheckCircle } from 'lucide-react';

// Stripe Payment Link post-payment redirect target.
//
// Set by stripe.service.ts:createConsultationPaymentLink as the
// after_completion.redirect.url — Stripe sends paying customers here
// once the hosted checkout flow completes. NO query params arrive
// (Stripe doesn't append a session id to Payment Link redirects, only
// to Checkout Sessions), so this page has no state to read.
//
// Deliberately static + reassuring:
//   • Server component — zero JS shipped for a one-off thank-you page
//   • No payment amount or order details — we have no auth context here
//     and the customer already saw both on Stripe's hosted page
//   • No promised timeline — onboarding follow-up varies by product
//   • One soft fallback link to the home page, no loud CTA — the
//     primary message is "we got it, we'll be in touch"

export const metadata = {
  title: 'Payment received — Sorena Visa',
};

export default function PaymentSuccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-sorena-cream px-4 py-12">
      <div className="text-center max-w-md">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle size={32} className="text-emerald-600" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-sorena-navy mb-3">
          Payment received
        </h1>
        <p className="text-gray-600 text-sm mb-2 leading-relaxed">
          Thank you &mdash; we&apos;ve received your payment.
        </p>
        <p className="text-gray-600 text-sm mb-8 leading-relaxed">
          Our team will be in touch shortly to confirm the next steps for your application.
          You can close this window any time.
        </p>
        <a
          href="/portal"
          className="text-sm text-sorena-navy/70 hover:text-sorena-navy underline"
        >
          Go to my portal
        </a>
      </div>
    </div>
  );
}
