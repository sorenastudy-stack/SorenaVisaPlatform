'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileSignature, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// PR-CLIENT-CONTRACT — client-side "Request my engagement contract" button for a
// REQUEST_CONTRACT next-step on /portal/case. The page is a server component, so
// the interactive call lives in this 'use client' child (same pattern as
// PayInvoiceButton / ReceiptUpload).
//
// Calls the client-scoped POST /portal/me/contract/request, which reuses the
// staff send engine (Phase A/B gate + DocuSeal) against the caller's OWN
// case/lead. On success the contract is emailed to the client; we show a calm
// confirmation and refresh so the next-steps re-render (the button drops off and
// a "check your email to sign" step takes its place). Duplicate sends are blocked
// server-side (engine guards + DB unique index), so a double-click is harmless.
//
// Strings are hardcoded English to match the surrounding next-steps section.
export function RequestContractButton() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();

  const handleRequest = async () => {
    setBusy(true);
    try {
      await api.post('/portal/me/contract/request', {});
      setDone(true);
      toast.success(
        "Your engagement letter is on its way! Check your email to review and sign — we'll take it from there.",
      );
      // Re-render the server component so the next-steps reflect the sent contract.
      router.refresh();
    } catch (err) {
      // The API returns the calm client-safe message for a locked/race state;
      // surface it verbatim rather than a generic error.
      toast.error(
        err instanceof Error
          ? err.message
          : "We're not quite ready to send your contract yet — we'll be in touch shortly to let you know what's needed.",
      );
      setBusy(false);
    }
  };

  if (done) {
    return (
      <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-sorena-jade">
        <CheckCircle2 size={13} /> On its way
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleRequest}
      disabled={busy}
      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-6 text-[#faf8f3] text-sm font-semibold min-h-[48px] hover:bg-[#162d4a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <FileSignature size={16} />}
      {busy ? 'Sending…' : 'Request my engagement contract'}
    </button>
  );
}
