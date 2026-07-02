'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { downloadPdf } from '@/lib/scorecard/pdf-download';

// PR-CLIENT-STAGE — client-side download button for the portal assessment card.
// The scorecard PDF is a backend-authenticated attachment, so it can't be a
// bare <a>; reuse the existing downloadPdf helper (fetch → blob → download),
// the same one the scorecard result page + staff buttons use.
export function AssessmentPdfButton({ submissionId }: { submissionId: string }) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);

  const handleDownload = async () => {
    setBusy(true);
    try {
      await downloadPdf(`/scorecard/${submissionId}/pdf`, 'sorena-assessment.pdf');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not download the assessment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-xl border border-[#1e3a5f]/30 px-4 py-2.5 text-sm font-semibold text-[#1e3a5f] transition-colors hover:bg-[#1e3a5f]/5 disabled:opacity-60 min-h-[44px]"
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
      {t('portal.assessment.pdf')}
    </button>
  );
}
