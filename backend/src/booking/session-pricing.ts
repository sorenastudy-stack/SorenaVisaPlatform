import { BookingSessionType, getSessionConfig } from './session-config';

// Phase E — the SINGLE source of session pricing math (money is computed here,
// server-side, in integer cents; never a client-sent total, never a float).
//
// Card fee is a PERCENTAGE (default 10%), env-overridable via
// SESSION_CARD_FEE_PERCENT. It is applied ONLY to card payments — wallet pays
// the base price with no fee. NOTE: this is deliberately NOT the flat
// CARD_SURCHARGE_CENTS used by the account-opening invoice (that stays a flat
// $20 and is untouched) — a flat fee on a $20 session would be a ~67% fee.

export interface SessionPricing {
  type: BookingSessionType;
  currency: string;      // ISO 4217, e.g. 'USD'
  paid: boolean;         // requiresPayment
  priceCents: number;    // base — the WALLET amount and the pre-fee card amount
  cardFeeCents: number;  // the disclosed card processing fee (0 when free)
  cardTotalCents: number; // priceCents + cardFeeCents — the CARD amount charged
  cardFeePercent: number; // the percent used (for disclosure)
}

/** Card fee percent. Env-overridable; safe default 10 (prod runs on the default
 *  — SESSION_CARD_FEE_PERCENT is unset in prod). Negative/NaN → 10. */
export function cardFeePercent(): number {
  const raw = Number(process.env.SESSION_CARD_FEE_PERCENT ?? 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 10;
}

/** Fee on a base amount, computed in INTEGER cents (round half-up on the cents,
 *  never a float-dollar multiply). A zero base → zero fee (free sessions can
 *  never accrue a charge). */
export function computeCardFeeCents(priceCents: number, percent = cardFeePercent()): number {
  if (priceCents <= 0) return 0;
  return Math.round((priceCents * percent) / 100);
}

/** Authoritative pricing for a session type, from config. `priceCents` derives
 *  from whole-dollar config prices (× 100 → exact integer). */
export function getSessionPricing(type: BookingSessionType): SessionPricing {
  const cfg = getSessionConfig(type);
  const percent = cardFeePercent();
  const priceCents = Math.round(cfg.price * 100);
  const cardFeeCents = computeCardFeeCents(priceCents, percent);
  return {
    type,
    currency: cfg.currency,
    paid: cfg.requiresPayment,
    priceCents,
    cardFeeCents,
    cardTotalCents: priceCents + cardFeeCents,
    cardFeePercent: percent,
  };
}

/** Fee + total for an ALREADY-HELD base amount (server-side, off the hold — the
 *  charge honours the held price/currency, not a re-read of config). Used at
 *  checkout so an in-flight hold pays exactly what it was quoted. */
export function cardChargeForHeld(baseCents: number): { cardFeeCents: number; cardTotalCents: number; cardFeePercent: number } {
  const percent = cardFeePercent();
  const cardFeeCents = computeCardFeeCents(baseCents, percent);
  return { cardFeeCents, cardTotalCents: baseCents + cardFeeCents, cardFeePercent: percent };
}
