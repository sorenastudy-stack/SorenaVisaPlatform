import { BookingSessionType, getSessionConfig } from './session-config';
import { calculateFeeBreakdown, FeeBreakdown } from '../payments/fee-config';

// Phase E — the SINGLE source of session pricing math (money is computed here,
// server-side, in integer cents; never a client-sent total, never a float).
//
// PR-GST-SESSIONS — this module used to own its own arithmetic: no GST at all,
// and a flat 10% card fee, tunable through a SESSION_CARD_FEE_PERCENT env var
// that is now DELETED along with cardFeePercent() and computeCardFeeCents() —
// it has no reader and is set in no Railway service or environment. Both were wrong, and both
// were wrong in the same way the account-opening fee and the chatbot CTA were
// wrong before they were corrected: a number derived by hand instead of read
// from the place that owns it.
//
//   GAP_CLOSING  charged  20.00 wallet / 22.00 card   should be 23.00 / 23.97
//   LIA          charged  58.00 wallet / 63.80 card   should be 66.70 / 68.93
//
// It now derives everything from fee-config's calculateFeeBreakdown, which is
// the same function the account-opening invoice, the pay screen, the tax invoice
// and the chatbot CTA use. That is the point: the booking page, the assessment
// report's "Book LIA" button and any consultation type added later now agree
// with the rest of the platform BY CONSTRUCTION, not by being fixed in parallel
// a fourth time.
//
// Order is fixed by fee-config and must not be re-derived here: GST on the base,
// then Stripe's 2.9% + $0.30 on the GST-inclusive amount. Wallet pays base + GST
// and no card fee — there is no card to process.

export interface SessionPricing {
  type: BookingSessionType;
  currency: string;       // ISO 4217, e.g. 'USD'
  paid: boolean;          // requiresPayment
  /** Pre-GST list price. Disclosure only — nobody is charged this. */
  baseCents: number;
  gstCents: number;
  /** base + GST — what is owed, and the WALLET amount. */
  priceCents: number;
  cardFeeCents: number;   // Stripe's cut (0 when free)
  /** priceCents + cardFeeCents — the CARD amount charged. */
  cardTotalCents: number;
}

/** The breakdown for a session type, straight from fee-config. */
function breakdownFor(type: BookingSessionType, method: 'card' | 'bank'): FeeBreakdown {
  const cfg = getSessionConfig(type);
  // Whole-dollar config prices × 100 → exact integer cents.
  return calculateFeeBreakdown(Math.round(cfg.price * 100), method, cfg.currency);
}

/** Authoritative pricing for a session type. */
export function getSessionPricing(type: BookingSessionType): SessionPricing {
  const cfg = getSessionConfig(type);
  // A free session has a zero base; fee-config already returns zeros for that,
  // so a free slot can never accrue GST or a card fee.
  const bank = breakdownFor(type, 'bank');
  const card = breakdownFor(type, 'card');
  return {
    type,
    currency: cfg.currency,
    paid: cfg.requiresPayment,
    baseCents: bank.baseCents,
    gstCents: bank.gstCents,
    priceCents: bank.totalCents,
    cardFeeCents: card.cardFeeCents,
    cardTotalCents: card.totalCents,
  };
}

/**
 * The charge for an ALREADY-HELD base amount.
 *
 * `baseCents` is the hold's stored pre-GST base — the meaning of the persisted
 * `amountNZD` column is deliberately UNCHANGED by this fix, so no existing row
 * silently means something new. GST and the card fee are derived here on every
 * read instead.
 *
 * Used at checkout and on the pay screen so an in-flight hold is charged exactly
 * what that screen shows it at the moment of payment.
 */
export function cardChargeForHeld(baseCents: number, currency?: string): {
  gstCents: number;
  /** base + GST — the wallet amount. */
  walletCents: number;
  cardFeeCents: number;
  cardTotalCents: number;
} {
  const bank = calculateFeeBreakdown(baseCents, 'bank', currency);
  const card = calculateFeeBreakdown(baseCents, 'card', currency);
  return {
    gstCents: bank.gstCents,
    walletCents: bank.totalCents,
    cardFeeCents: card.cardFeeCents,
    cardTotalCents: card.totalCents,
  };
}
