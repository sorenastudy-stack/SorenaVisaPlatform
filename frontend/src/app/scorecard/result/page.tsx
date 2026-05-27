import { redirect } from 'next/navigation';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { ScorecardResultClient } from '@/components/scorecard/ScorecardResultClient';

// PR-SCORECARD-2 — Public scorecard result page (server shell).

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
  gateResults: Record<string, boolean>;
  nextAction: 'NURTURE_ONLY' | 'PAY_GAP_CLOSING_SESSION' | 'BOOK_FREE_15MIN_SESSION' | 'BLOCKED_HARD_STOP';
  nextActionTextEn: string;
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

  return <ScorecardResultClient data={data!} />;
}
