import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OpsHandoffsService, PendingHandoffsResponse } from '../ops-handoffs/ops-handoffs.service';
import { getEngagementGateState } from '../common/engagement-payment.helper';

// PR-HANDOFFS — Owner-dashboard Handoffs section (Definition A: staffing handoff).
//
// Two read-only surfaces, no schema change, no writes:
//
//  1. STAFFING EXCEPTIONS — reused verbatim from OpsHandoffsService: a specialist
//     slot is empty AND the case is already past the lifecycle point where
//     auto-assignment should have filled it (LIA/Admission/Finance after contract
//     sign; Pastoral after visa approval; Client Officer via pool-empty banner +
//     no-candidates audit; plus wrong-role owner). We do NOT re-implement these —
//     divergence between /ops/handoffs and /staff/handoffs is impossible by
//     construction.
//
//  2. STUCK CASES (Option 3) — three progression stalls detectable from state
//     that ALREADY exists, no new tracking:
//       • SIGNED_PAID_STUCK_ADMISSION — contract signed + engagement invoice PAID
//         but the case never left ADMISSION (nobody advanced it).
//       • VISA_APPROVED_NO_PASTORAL — visa APPROVED but no pastoral (support) slot.
//         NB: this intentionally coincides with the Pastoral staffing exception —
//         it's the same real-world stall seen from the progression angle.
//       • INZ_SUBMITTED_AGED — sitting in INZ_SUBMITTED past a display threshold
//         (measured from the existing inzSubmittedAt) with no visa outcome yet.
//
// DEFERRED (Option 2, backlog — same category as the SLA/deadline system deferred
// in Compliance): a real stage-transition history (a CaseStageTransition table, or
// STATUS_CHANGED audit emission on every CRM stage write). Without it we cannot
// answer "how long has this case been in stage X" for any transition other than
// INZ_SUBMITTED (the one stage that happens to stamp a timestamp). Surfaced as a
// backlog note in the UI, not stubbed.

export type StuckRule =
  | 'SIGNED_PAID_STUCK_ADMISSION'
  | 'VISA_APPROVED_NO_PASTORAL'
  | 'INZ_SUBMITTED_AGED';

export interface StuckCaseRow {
  caseId: string;
  clientName: string | null;
  stage: string;
  rule: StuckRule;
  detail: string;
  waitingSince: Date | null;
}

export interface HandoffsResponse {
  staffing: PendingHandoffsResponse;
  stuck: StuckCaseRow[];
  // Surfaced so the UI can render the "measured from" heuristic honestly.
  inzAgeThresholdDays: number;
}

// INZ processing legitimately takes weeks, so this is a "worth a look" display
// heuristic — NOT an enforced SLA (no SLA/deadline system exists; deferred).
const INZ_AGE_THRESHOLD_DAYS = 21;

@Injectable()
export class HandoffsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opsHandoffs: OpsHandoffsService,
  ) {}

  async getHandoffs(): Promise<HandoffsResponse> {
    const [staffing, stuck] = await Promise.all([
      this.opsHandoffs.listPendingHandoffs(),
      this.listStuckCases(),
    ]);
    return { staffing, stuck, inzAgeThresholdDays: INZ_AGE_THRESHOLD_DAYS };
  }

  // The three progression-stall rules. Each is state-derived from data that
  // already exists — no new columns, no writes.
  private async listStuckCases(): Promise<StuckCaseRow[]> {
    const now = new Date();
    const rows: StuckCaseRow[] = [];

    // ── Rule 1: SIGNED_PAID_STUCK_ADMISSION ──────────────────────────────────
    // Contract signed + engagement invoice PAID, but stage never left ADMISSION.
    const admissionCandidates = await this.prisma.case.findMany({
      where: {
        stage: 'ADMISSION',
        contract: { signedAt: { not: null } },
      },
      select: {
        id: true,
        contract: { select: { signedAt: true } },
        lead: { select: { contact: { select: { fullName: true } } } },
      },
    });
    // getEngagementGateState is the fail-safe SSOT for "is the ENG fee paid?" —
    // reuse it so this rule can't disagree with the portal access gate.
    for (const c of admissionCandidates) {
      const gate = await getEngagementGateState(this.prisma, c.id);
      if (!gate.paid) continue;
      rows.push({
        caseId: c.id,
        clientName: c.lead?.contact?.fullName ?? null,
        stage: 'ADMISSION',
        rule: 'SIGNED_PAID_STUCK_ADMISSION',
        detail: 'Contract signed and engagement fee paid, but the case is still in Admission.',
        waitingSince: c.contract?.signedAt ?? null,
      });
    }

    // ── Rule 2: VISA_APPROVED_NO_PASTORAL ────────────────────────────────────
    // Visa approved but no pastoral (support) slot to pick the client up.
    const approvedNoPastoral = await this.prisma.case.findMany({
      where: {
        stage: { not: 'WITHDRAWN' },
        supportId: null,
        visa: { outcome: 'APPROVED' },
      },
      select: {
        id: true,
        stage: true,
        visa: { select: { issuedAt: true } },
        lead: { select: { contact: { select: { fullName: true } } } },
      },
    });
    for (const c of approvedNoPastoral) {
      rows.push({
        caseId: c.id,
        clientName: c.lead?.contact?.fullName ?? null,
        stage: String(c.stage),
        rule: 'VISA_APPROVED_NO_PASTORAL',
        detail: 'Visa approved but no Pastoral Care officer is assigned to hand the client over to.',
        waitingSince: c.visa?.issuedAt ?? null,
      });
    }

    // ── Rule 3: INZ_SUBMITTED_AGED ───────────────────────────────────────────
    // In INZ_SUBMITTED past the display threshold, with no visa record yet.
    const threshold = new Date(now.getTime() - INZ_AGE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
    const agedInz = await this.prisma.case.findMany({
      where: {
        stage: 'INZ_SUBMITTED',
        inzSubmittedAt: { not: null, lte: threshold },
        visa: null,
      },
      select: {
        id: true,
        inzSubmittedAt: true,
        lead: { select: { contact: { select: { fullName: true } } } },
      },
    });
    for (const c of agedInz) {
      rows.push({
        caseId: c.id,
        clientName: c.lead?.contact?.fullName ?? null,
        stage: 'INZ_SUBMITTED',
        rule: 'INZ_SUBMITTED_AGED',
        detail: `Submitted to Immigration NZ over ${INZ_AGE_THRESHOLD_DAYS} days ago with no visa outcome recorded yet.`,
        waitingSince: c.inzSubmittedAt ?? null,
      });
    }

    // Oldest-waiting-first, matching the staffing-exceptions ordering.
    rows.sort((a, b) => {
      const at = a.waitingSince?.getTime() ?? Infinity;
      const bt = b.waitingSince?.getTime() ?? Infinity;
      return at - bt;
    });
    return rows;
  }
}
