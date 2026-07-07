'use client';

import { useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// Client-side "Pay now" button for an INVOICE next-step on /portal/case.
// The page is a server component, so the interactive call + redirect must
// live in a 'use client' child (same pattern as AssessmentPdfButton).
//
// Calls the client-scoped POST /portal/me/invoices/:invoiceId/pay-link,
// which returns a Stripe hosted payment URL, then redirects the browser to
// it. On success we navigate away, so `busy` is only reset on error.
//
// Strings are hardcoded English to match the surrounding next-steps section
// (its heading + the "Open" link are hardcoded too — no lone i18n call).
export function PayInvoiceButton({ invoiceId, label = 'Pay now' }: { invoiceId: string; label?: string }) {
  const [busy, setBusy] = useState(false);

  const handlePay = async () => {
    setBusy(true);
    try {
      const { url } = await api.post<{ url: string }>(
        `/portal/me/invoices/${invoiceId}/pay-link`,
        {},
      );
      window.location.href = url; // hand off to Stripe's hosted page
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start payment');
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handlePay}
      disabled={busy}
      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-6 text-[#faf8f3] font-semibold min-h-[48px] hover:bg-[#162d4a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
      {busy ? 'Redirecting…' : label}
    </button>
  );
}
