// PR-PHASE40 — the single source of truth for every fee the platform charges.
//
// WHY THIS EXISTS. Prices lived in two places that disagreed. session-config.ts
// priced a Gap-Closing session at USD 20 and an LIA consultation at USD 58;
// payments.service.ts, which builds the Stripe payment links sales sends out,
// had its own table saying NZD 30 and NZD 150. Same session, different money,
// depending on which door the client came through.
//
// The booking side was already right — USD, config-driven, one place — so it
// stays the reference and is re-exported here UNCHANGED. This module adds the
// two fees that are not bookable sessions (there is no calendar slot to hold
// for "open an account"), and owns the tax and card-fee arithmetic that applies
// to all of them.
//
// Money is INTEGER CENTS throughout. A float dollar multiplied by 0.15 gives
// 2.9999999999999996, and that rounds into a real invoice.

import { BookingSessionType, getSessionConfig } from '../booking/session-config';

/** Everything the platform charges for. */
export type FeeType =
  | 'FREE_15'
  | 'GAP_CLOSING'
  | 'LIA_CONSULTATION'
  | 'ADMISSION_CONSULTATION'
  | 'ACCOUNT_OPENING';

export const FEE_CURRENCY = 'usd';

// The three bookable types map onto session-config's own names. LIA is called
// LIA_CONSULTATION on the payment side and LIA on the booking side; that
// mismatch is why the two tables drifted, so it is resolved here rather than
// left for the next reader to trip over.
const BOOKABLE: Partial<Record<FeeType, BookingSessionType>> = {
  FREE_15: 'FREE_15',
  GAP_CLOSING: 'GAP_CLOSING',
  LIA_CONSULTATION: 'LIA',
};

// Fees with no calendar slot, defined here because session-config models
// BOOKABLE SESSIONS and adding these to it would surface them in
// GET /booking/session-types as things a client could book.
const NON_BOOKABLE: Partial<Record<FeeType, { priceCents: number; label: string }>> = {
  ADMISSION_CONSULTATION: { priceCents: 5000, label: 'Admission Consultation' },
  ACCOUNT_OPENING: { priceCents: 20000, label: 'Account Opening' },
};

export interface FeeDefinition {
  type: FeeType;
  /** Base price in integer cents, BEFORE GST and any card fee. */
  priceCents: number;
  currency: string;
  label: string;
}

export function getFee(type: FeeType): FeeDefinition {
  const bookable = BOOKABLE[type];
  if (bookable) {
    // Re-exported from the booking config — deliberately NOT copied, so the two
    // can never disagree again.
    const cfg = getSessionConfig(bookable);
    return {
      type,
      priceCents: Math.round(cfg.price * 100),
      currency: cfg.currency.toLowerCase(),
      label: cfg.label,
    };
  }
  const own = NON_BOOKABLE[type];
  if (!own) throw new Error(`Unknown fee type: ${type}`);
  return { type, priceCents: own.priceCents, currency: FEE_CURRENCY, label: own.label };
}

/** Base price in cents. Throws on an unknown type rather than defaulting to 0. */
export function getFeePriceCents(type: FeeType): number {
  return getFee(type).priceCents;
}

export function isFeeType(value: string): value is FeeType {
  return value === 'FREE_15' || value === 'GAP_CLOSING' || value === 'LIA_CONSULTATION'
    || value === 'ADMISSION_CONSULTATION' || value === 'ACCOUNT_OPENING';
}

// ── Tax ─────────────────────────────────────────────────────────────────────

/**
 * NZ GST, 15%, on every invoice with no exceptions.
 *
 * Not a surcharge and not optional: Sorenastudy Limited is GST-registered
 * (131454295), so this is tax collected on the company's behalf, which is why
 * it is stored as its own column rather than folded into a total.
 *
 * Rounded half-up on the cent. A 15% rate on whole-dollar prices is exact
 * anyway (2000 → 300), but the rounding is explicit so a future non-round price
 * cannot produce a fractional cent.
 */
export const GST_RATE = 0.15;

export function calculateGST(baseAmountCents: number): number {
  if (baseAmountCents <= 0) return 0;
  return Math.round(baseAmountCents * GST_RATE);
}

// ── Card processing fee ─────────────────────────────────────────────────────

/**
 * Stripe's card fee, passed through on CARD payments only.
 *
 * 2.9% + $0.30, charged on the GST-INCLUSIVE amount — Stripe takes its cut of
 * everything it moves, tax included, so charging it on the base alone would
 * under-recover. Order matters and is fixed: GST first, card fee on top.
 *
 * Bank transfer pays base + GST and nothing else; there is no card to process.
 * Never persisted onto the invoice amount — it is a payment-method line, and an
 * invoice paid by transfer must not carry a fee the client never incurred.
 */
export const CARD_FEE_PERCENT = 0.029;
export const CARD_FEE_FIXED_CENTS = 30;

export function calculateCardSurcharge(baseAmountCents: number): number {
  if (baseAmountCents <= 0) return 0;
  const gstInclusive = baseAmountCents + calculateGST(baseAmountCents);
  return Math.round(gstInclusive * CARD_FEE_PERCENT) + CARD_FEE_FIXED_CENTS;
}

export interface FeeBreakdown {
  baseCents: number;
  gstCents: number;
  /** base + GST — what a bank transfer pays. */
  subtotalWithGstCents: number;
  /** 0 for bank transfer. */
  cardFeeCents: number;
  /** What the client actually pays by this method. */
  totalCents: number;
  currency: string;
  paymentMethod: 'card' | 'bank';
}

/** The whole invoice arithmetic in one place, so no caller re-derives it. */
export function calculateFeeBreakdown(
  baseAmountCents: number,
  paymentMethod: 'card' | 'bank',
  currency: string = FEE_CURRENCY,
): FeeBreakdown {
  const gstCents = calculateGST(baseAmountCents);
  const subtotalWithGstCents = baseAmountCents + gstCents;
  const cardFeeCents = paymentMethod === 'card' ? calculateCardSurcharge(baseAmountCents) : 0;
  return {
    baseCents: baseAmountCents,
    gstCents,
    subtotalWithGstCents,
    cardFeeCents,
    totalCents: subtotalWithGstCents + cardFeeCents,
    currency,
    paymentMethod,
  };
}
