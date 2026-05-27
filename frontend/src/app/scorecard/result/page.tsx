import { redirect } from 'next/navigation';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { ScorecardResultClient } from '@/components/scorecard/ScorecardResultClient';
import { ScorecardHeader } from '@/components/scorecard/ScorecardHeader';

// PR-SCORECARD-2 — Public scorecard result page (server shell).
//
// Fix 5: gateResults is now a SORTED ARRAY (server-side numerical
// order) rather than an object — object key iteration order is not
// guaranteed for string keys and the gates were rendering in
// 1, 4, 2, 5, 3 order on the client.

export interface ScorecardResultPayload {
  submissionId: string;
  totalScore: number;
  band: 'BAND_1' | 'BAND_2' | 'BAND_3' | 'BAND_4' | 'BAND_5' | 'BAND_6';
  bandName: string;
  bandRange: string;
  categoryScores: Record<number, number>;
  hardStops: Array<{ code: string; name: string; reason: string; resolution: string }>;
  riskFlags: string[];
  executionEligible: boolean;
  gateResults: Array<{ gateNumber: 1 | 2 | 3 | 4 | 5; label: string; passed: boolean }>;
  nextAction: 'NURTURE_ONLY' | 'PAY_GAP_CLOSING_SESSION' | 'BOOK_FREE_15MIN_SESSION' | 'BLOCKED_HARD_STOP';
  nextActionTextEn: string;
  // Fix 9: nextActionTextFa is kept in the response shape for API
  // compatibility but is unused on the public scorecard pages (English-
  // only). The staff scorecard detail page still reads it; the backend
  // populates it with the English text as a no-op fallback.
  nextActionTextFa: string;
  shouldShowMalaysiaCallout: boolean;
  shouldShowBookingLink: boolean;
  shouldShowPaymentLink: boolean;
  shouldShowNurtureMessage: boolean;
  answers?: Record<string, string>;
  perFieldScores?: Record<string, { answer: string; points: number }>;
  submittedAt: string;
  leadId: string | null;
  consultationBookedAt: string | null;
}

export default async function ScorecardResultPage() {
  let data: ScorecardResultPayload | null = null;
  try {
    data = await apiServer.get<ScorecardResultPayload>('/scorecard/me/latest');
  } catch (e) {
    if (e instanceof ApiServerError && e.statusCode === 401) {
      redirect('/login?returnTo=/scorecard/result');
    }
    if (e instanceof ApiServerError && e.statusCode === 404) {
      redirect('/scorecard/landing');
    }
  }

  if (!data) {
    redirect('/scorecard/landing');
  }

  return (
    <>
      <ScorecardHeader />
      <ScorecardResultClient data={data!} />
    </>
  );
}
