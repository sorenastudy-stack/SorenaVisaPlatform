'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { downloadPdf } from '@/lib/scorecard/pdf-download';

// PR-TAX-INVOICE — the client's way to get the document.
//
// The PDF is a backend-authenticated attachment, so this can't be a bare <a>
// href: the browser would send no Authorization header and get a 401. Reuses
// `downloadPdf` (token → fetch → blob → click), the same helper the scorecard
// and assessment buttons use.
//
// The filename comes from the server's Content-Disposition (the invoice
// number); the suggestion below is only a fallback.
export function InvoicePdfButton({
  invoiceId,
  invoiceNumber,
  label,
  variant = 'outline',
}: {
  invoiceId: string;
  invoiceNumber: string;
  label: string;
  variant?: 'outline' | 'subtle';
}) {
  const [busy, setBusy] = useState(false);

  const handleDownload = async () => {
    setBusy(true);
    try {
      await downloadPdf(`/portal/me/invoices/${invoiceId}/pdf`, `${invoiceNumber}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not download the invoice.');
    } finally {
      setBusy(false);
    }
  };

  const styles =
    variant === 'subtle'
      ? 'text-[#1e3a5f] hover:bg-[#1e3a5f]/5 px-3 py-2 text-xs'
      : 'border border-[#1e3a5f]/30 text-[#1e3a5f] hover:bg-[#1e3a5f]/5 px-4 py-2.5 text-sm';

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={busy}
      className={`inline-flex items-center gap-2 rounded-xl font-semibold transition-colors disabled:opacity-60 min-h-[44px] ${styles}`}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
      {label}
    </button>
  );
}
