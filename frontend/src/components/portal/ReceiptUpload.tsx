'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// Client-side receipt upload for the bank-transfer / partner-exchange paths on
// /portal/case/pay. Posts multipart (file + method) to the client-scoped
// receipt endpoint; on success it refreshes the server component so the page
// re-renders into the "we're confirming it" processing state. Client-side
// type/size checks mirror the server's allowlist for a friendly early error.

const ACCEPT = '.pdf,.jpg,.jpeg,.png';
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_BYTES = 10 * 1024 * 1024;

export function ReceiptUpload({
  invoiceId,
  method,
}: {
  invoiceId: string;
  method: 'bank' | 'exchange';
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;

    if (!ALLOWED.includes(file.type)) {
      toast.error('Please upload a PDF, JPG, or PNG.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('File exceeds the 10 MB limit.');
      return;
    }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('method', method);
      await api.upload(`/portal/me/invoices/${invoiceId}/receipt`, fd);
      toast.success("Receipt uploaded — we're confirming your payment.");
      router.refresh(); // re-render into the processing state (component unmounts)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={handleFile}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#1e3a5f]/25 px-5 py-2.5 text-sm font-semibold text-[#1e3a5f] transition-colors hover:bg-[#1e3a5f]/5 disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        {busy ? 'Uploading…' : 'Upload your receipt'}
      </button>
      <p className="mt-1.5 text-xs leading-relaxed text-[#4A4A4A]/55">
        Already paid by {method === 'bank' ? 'bank transfer' : 'partner exchange'}? Upload your
        receipt to confirm. PDF, JPG, or PNG, up to 10 MB.
      </p>
    </div>
  );
}
