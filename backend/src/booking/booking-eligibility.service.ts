import { ForbiddenException, Injectable } from '@nestjs/common';
import { ScorecardBand } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BookingSessionType, getSessionConfig } from './session-config';

// Phase C — booking eligibility (live, honest, single source of truth).
//
// Reconciles TWO layers into one per-type verdict:
//   1. Scorecard-derived: `band` (from the latest submission — snapshot is
//      honest, nothing mutates band post-submit) + LIVE hard-stop state.
//   2. Booking-flow gates: free-once (FREE_15), verified-LIA availability (LIA),
//      payment (a step flagged on the type, not a block).
//
// LIVE hard-stop source (the bug this fixes): the LIA clears a blocker on the
// CASE's lead (Case.lead.hardStopFlag), NOT on the latest submission's lead
// (a fresh Lead is created per submission). So we read the active Case's lead
// when one exists, else fall back to the submission's lead. `hardStopSource`
// reports which, for provenance.
//
// The reason strings are plain English and returned in the payload — both the
// report and the (future) booking page render identical copy with NO next-intl
// keys (Persian is frozen).

export type PrimaryType = BookingSessionType;

export interface TypeEligibility {
  type: BookingSessionType;
  eligible: boolean;
  reason: string; // human English — why available (eligible) or why blocked
  paid: boolean;
  priceNzd: number;
}

export interface BookingEligibilityResponse {
  hasSubmission: boolean;
  band: ScorecardBand | null;
  liveHardStop: boolean;
  hardStopSource: 'case' | 'submission' | null;
  types: TypeEligibility[];
  primaryType: PrimaryType | null;
}

// ── Reason copy (English only — no t() keys, Persian frozen) ──────────────────
const REASONS = {
  NO_SUBMISSION:   'Take your free assessment first to unlock consultations.',
  FREE15_BAND:     'Your free 15-minute consultation opens once your assessment reaches Band 4 or above.',
  FREE15_HARDSTOP: 'Available after your Licensed Immigration Adviser clears the blocking item on your file.',
  FREE15_USED:     "You've already used your free consultation. Choose a paid session to continue.",
  FREE15_OK:       'You qualify to start your application journey. This free 15-minute session confirms your pathway and next steps, and is required before we open your case file.',
  GAP_HARDSTOP:    'A legal issue on your file must be cleared by an adviser before a Gap-Closing session applies.',
  GAP_OK:          'Your assessment shows real potential with specific areas to close first. This paid 30-minute session with an Admission Specialist gives you a structured improvement plan.',
  LIA_NO_ADVISER:  'No licensed adviser is available to book right now. Please check back soon.',
  LIA_OK_HARDSTOP: 'A specific legal issue on your file needs your Licensed Immigration Adviser. This paid 30-minute session resolves the blocking item so you can move forward.',
  LIA_OK_GENERAL:  'Book a paid 30-minute consultation with our Licensed Immigration Adviser for tailored legal guidance on your case.',
} as const;

function bandLabel(band: ScorecardBand | null): string {
  return band ? band.replace('BAND_', 'Band ') : 'not yet scored';
}
function isHighBand(band: ScorecardBand | null): boolean {
  return band === 'BAND_4' || band === 'BAND_5' || band === 'BAND_6';
}

const TERMINAL_STAGES = ['COMPLETED', 'WITHDRAWN'] as const;

@Injectable()
export class BookingEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async getEligibility(userId: string): Promise<BookingEligibilityResponse> {
    // ── band: latest REAL submission (isDraft=false). Snapshot is honest. ──
    const submission = await this.prisma.scorecardSubmission.findFirst({
      where: { userId, isDraft: false },
      orderBy: { submittedAt: 'desc' },
      select: { band: true, leadId: true },
    });
    const hasSubmission = !!submission;
    const band = submission?.band ?? null;

    // ── LIVE hard-stop: active Case lead wins; else the submission's lead. ──
    let liveHardStop = false;
    let hardStopSource: 'case' | 'submission' | null = null;
    const activeCase = await this.prisma.case.findFirst({
      where: { lead: { contact: { userId } }, stage: { notIn: [...TERMINAL_STAGES] } },
      orderBy: { createdAt: 'desc' },
      select: { lead: { select: { hardStopFlag: true } } },
    });
    if (activeCase) {
      liveHardStop = activeCase.lead.hardStopFlag;
      hardStopSource = 'case';
    } else if (submission?.leadId) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: submission.leadId },
        select: { hardStopFlag: true },
      });
      liveHardStop = lead?.hardStopFlag ?? false;
      hardStopSource = 'submission';
    }

    // ── booking-flow gates ──
    const freeUsed = await this.hasUsedFreeSession(userId);
    const liaAdviserAvailable = (await this.countVerifiedLiaAdvisers()) > 0;

    const types: TypeEligibility[] = [
      this.evalFree15(hasSubmission, band, liveHardStop, freeUsed),
      this.evalGap(hasSubmission, band, liveHardStop),
      this.evalLia(hasSubmission, liaAdviserAvailable, liveHardStop),
    ];

    return {
      hasSubmission,
      band,
      liveHardStop,
      hardStopSource,
      types,
      primaryType: this.derivePrimary(hasSubmission, band, liveHardStop),
    };
  }

  /**
   * Server-side gate for the write paths. MUST run inside the service layer
   * (createFreeBooking / createHold) so no booking can bypass it. Throws
   * ForbiddenException(reason) → HTTP 403, distinct from the 409 slot-taken.
   */
  async assertEligible(userId: string, type: BookingSessionType): Promise<void> {
    const elig = await this.getEligibility(userId);
    const t = elig.types.find((x) => x.type === type);
    if (!t || !t.eligible) {
      throw new ForbiddenException(t?.reason ?? 'This session type is not available for your account.');
    }
  }

  // ── Per-type verdicts (precedence: band → live-hard-stop → booking-flow) ──

  private evalFree15(
    hasSubmission: boolean,
    band: ScorecardBand | null,
    liveHardStop: boolean,
    freeUsed: boolean,
  ): TypeEligibility {
    const base = { type: 'FREE_15' as const, paid: false, priceNzd: getSessionConfig('FREE_15').priceNZD };
    if (!hasSubmission)   return { ...base, eligible: false, reason: REASONS.NO_SUBMISSION };
    if (!isHighBand(band)) return { ...base, eligible: false, reason: REASONS.FREE15_BAND };
    if (liveHardStop)     return { ...base, eligible: false, reason: REASONS.FREE15_HARDSTOP };
    if (freeUsed)         return { ...base, eligible: false, reason: REASONS.FREE15_USED };
    return { ...base, eligible: true, reason: REASONS.FREE15_OK };
  }

  private evalGap(
    hasSubmission: boolean,
    band: ScorecardBand | null,
    liveHardStop: boolean,
  ): TypeEligibility {
    const base = { type: 'GAP_CLOSING' as const, paid: true, priceNzd: getSessionConfig('GAP_CLOSING').priceNZD };
    if (!hasSubmission)      return { ...base, eligible: false, reason: REASONS.NO_SUBMISSION };
    if (band !== 'BAND_3')   return { ...base, eligible: false, reason: `The Gap-Closing session is for Band 3 profiles; your assessment is ${bandLabel(band)}.` };
    if (liveHardStop)        return { ...base, eligible: false, reason: REASONS.GAP_HARDSTOP };
    return { ...base, eligible: true, reason: REASONS.GAP_OK };
  }

  // Flag-3 change: LIA is a paid service, ALWAYS bookable when a verified adviser
  // is available — no band gate, no hard-stop gate. The only blocks are
  // no-submission, and no verified adviser. (Payment is a step, flagged `paid`.)
  private evalLia(
    hasSubmission: boolean,
    liaAdviserAvailable: boolean,
    liveHardStop: boolean,
  ): TypeEligibility {
    const base = { type: 'LIA' as const, paid: true, priceNzd: getSessionConfig('LIA').priceNZD };
    if (!hasSubmission)        return { ...base, eligible: false, reason: REASONS.NO_SUBMISSION };
    if (!liaAdviserAvailable)  return { ...base, eligible: false, reason: REASONS.LIA_NO_ADVISER };
    return { ...base, eligible: true, reason: liveHardStop ? REASONS.LIA_OK_HARDSTOP : REASONS.LIA_OK_GENERAL };
  }

  // Headline CTA for the report (unchanged behaviour): hard stop → LIA; else
  // band 4-6 → FREE_15; band 3 → GAP; band 1-2 no hard stop → nurture (null).
  private derivePrimary(
    hasSubmission: boolean,
    band: ScorecardBand | null,
    liveHardStop: boolean,
  ): PrimaryType | null {
    if (!hasSubmission) return null;
    if (liveHardStop) return 'LIA';
    if (isHighBand(band)) return 'FREE_15';
    if (band === 'BAND_3') return 'GAP_CLOSING';
    return null;
  }

  // ── Booking-flow reads (replicated from BookingService to keep this service
  //    dependency-free; BookingService still enforces free-once itself). ──

  private async hasUsedFreeSession(userId: string): Promise<boolean> {
    const count = await this.prisma.consultation.count({
      where: { type: 'FREE_15', status: { not: 'CANCELLED' }, lead: { contact: { userId } } },
    });
    return count > 0;
  }

  private async countVerifiedLiaAdvisers(): Promise<number> {
    return this.prisma.user.count({
      where: { role: 'LIA', isActive: true, liaProfile: { iaaLicenceVerifiedAt: { not: null } } },
    });
  }
}
