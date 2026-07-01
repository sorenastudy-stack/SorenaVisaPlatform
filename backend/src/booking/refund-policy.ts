import { WalletTransactionType } from '@prisma/client';

// PR-WALLET slice 2 — tiered cancellation/no-show refund policy (pure math).
//
// FIXED RULES (official policy):
//   • Client cancels >= 24h before start → 100% credited, 0 retained.
//   • Client cancels  < 24h before start → 20% retained, 80% credited.
//   • No-show (human-marked)             → 25% retained, 75% credited.
//   • Boundary: exactly 24h counts as the 100% tier (>= 24h → full).
//   • retainedCents = round(amount * retainedPct); creditCents = amount − retained.
//     So retained + credit ALWAYS equals the original amount exactly.
//   • ALL integer cents, computed off Payment.amount — never a float.

export type RefundKind = 'CANCEL' | 'NO_SHOW';

export interface RefundResult {
  type: WalletTransactionType; // REFUND_CANCEL_FULL | REFUND_CANCEL_LATE | REFUND_NO_SHOW
  retainedPct: number;
  retainedCents: number;
  creditCents: number;
  tierLabel: string;
}

function tierFor(kind: RefundKind, hoursUntilStart: number): {
  pct: number; type: WalletTransactionType; label: string;
} {
  if (kind === 'NO_SHOW') {
    return { pct: 0.25, type: 'REFUND_NO_SHOW', label: 'no-show' };
  }
  // CANCEL — boundary is inclusive: exactly 24h is still the full-refund tier.
  if (hoursUntilStart >= 24) {
    return { pct: 0, type: 'REFUND_CANCEL_FULL', label: 'cancelled 24h or more before' };
  }
  return { pct: 0.20, type: 'REFUND_CANCEL_LATE', label: 'cancelled within 24h' };
}

/**
 * Compute the tiered refund for a PAID booking. `paymentAmountCents` MUST be
 * the captured amount in integer cents (Payment.amount). `hoursUntilStart`
 * is ignored for NO_SHOW.
 */
export function computeRefund(
  paymentAmountCents: number,
  kind: RefundKind,
  hoursUntilStart: number,
): RefundResult {
  const { pct, type, label } = tierFor(kind, hoursUntilStart);
  const retainedCents = Math.round(paymentAmountCents * pct);
  const creditCents = paymentAmountCents - retainedCents;
  return { type, retainedPct: pct, retainedCents, creditCents, tierLabel: label };
}

/** Hours between `now` and the session start (may be negative if past). */
export function hoursUntil(scheduledAt: Date, now: Date): number {
  return (scheduledAt.getTime() - now.getTime()) / 3_600_000;
}
