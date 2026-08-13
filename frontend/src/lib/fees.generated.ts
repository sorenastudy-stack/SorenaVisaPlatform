// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Source of truth: backend/src/payments/fee-config.ts
// Regenerate:      cd backend && npm run gen:fees
// CI guard:        npm run gen:fees:check (fails if this file is stale)
//
// Hand-editing a figure here reintroduces exactly the bug this file exists to
// prevent: a price written down in one place and changed in another.
//
// Choose the quantity deliberately. `base` is the pre-GST list price and is
// almost never what a client pays — quoting it is how "USD 200" ended up beside
// a USD 230.00 invoice.

export const GST_RATE = 0.15;
export const GST_PERCENT_LABEL = 'GST 15%';

export interface FeeCopy {
  currency: string;
  baseCents: number;
  gstCents: number;
  bankTotalCents: number;
  cardTotalCents: number;
  base: string;
  total: string;
  inclGst: string;
  plusGst: string;
  cardTotal: string;
}

export const FEES = {
  ACCOUNT_OPENING: {
    currency: 'USD',
    baseCents: 20000,
    gstCents: 3000,
    /** base + GST — what a bank transfer pays, and what a price "costs". */
    bankTotalCents: 23000,
    /** base + GST + Stripe's cut — only correct when paying by card. */
    cardTotalCents: 23697,
    /** "USD 200" — the list price, GST NOT included. */
    base: 'USD 200',
    /** "USD 230" — the amount owed, bare, for callers
     *  that supply their own wording (e.g. "USD 230 (incl. GST)"). */
    total: 'USD 230',
    /** "USD 230 incl. GST" — what a client will pay. */
    inclGst: 'USD 230 incl. GST',
    /** "USD 200 + GST" — when the split is stated separately. */
    plusGst: 'USD 200 + GST',
    /** "USD 236.97" — total when paying by card. */
    cardTotal: 'USD 236.97',
  },
  LIA_CONSULTATION: {
    currency: 'USD',
    baseCents: 5800,
    gstCents: 870,
    /** base + GST — what a bank transfer pays, and what a price "costs". */
    bankTotalCents: 6670,
    /** base + GST + Stripe's cut — only correct when paying by card. */
    cardTotalCents: 6893,
    /** "USD 58" — the list price, GST NOT included. */
    base: 'USD 58',
    /** "USD 66.70" — the amount owed, bare, for callers
     *  that supply their own wording (e.g. "USD 230 (incl. GST)"). */
    total: 'USD 66.70',
    /** "USD 66.70 incl. GST" — what a client will pay. */
    inclGst: 'USD 66.70 incl. GST',
    /** "USD 58 + GST" — when the split is stated separately. */
    plusGst: 'USD 58 + GST',
    /** "USD 68.93" — total when paying by card. */
    cardTotal: 'USD 68.93',
  },
  ADMISSION_CONSULTATION: {
    currency: 'USD',
    baseCents: 5000,
    gstCents: 750,
    /** base + GST — what a bank transfer pays, and what a price "costs". */
    bankTotalCents: 5750,
    /** base + GST + Stripe's cut — only correct when paying by card. */
    cardTotalCents: 5947,
    /** "USD 50" — the list price, GST NOT included. */
    base: 'USD 50',
    /** "USD 57.50" — the amount owed, bare, for callers
     *  that supply their own wording (e.g. "USD 230 (incl. GST)"). */
    total: 'USD 57.50',
    /** "USD 57.50 incl. GST" — what a client will pay. */
    inclGst: 'USD 57.50 incl. GST',
    /** "USD 50 + GST" — when the split is stated separately. */
    plusGst: 'USD 50 + GST',
    /** "USD 59.47" — total when paying by card. */
    cardTotal: 'USD 59.47',
  },
  GAP_CLOSING: {
    currency: 'USD',
    baseCents: 2000,
    gstCents: 300,
    /** base + GST — what a bank transfer pays, and what a price "costs". */
    bankTotalCents: 2300,
    /** base + GST + Stripe's cut — only correct when paying by card. */
    cardTotalCents: 2397,
    /** "USD 20" — the list price, GST NOT included. */
    base: 'USD 20',
    /** "USD 23" — the amount owed, bare, for callers
     *  that supply their own wording (e.g. "USD 230 (incl. GST)"). */
    total: 'USD 23',
    /** "USD 23 incl. GST" — what a client will pay. */
    inclGst: 'USD 23 incl. GST',
    /** "USD 20 + GST" — when the split is stated separately. */
    plusGst: 'USD 20 + GST',
    /** "USD 23.97" — total when paying by card. */
    cardTotal: 'USD 23.97',
  },
  FREE_15: {
    currency: 'USD',
    baseCents: 0,
    gstCents: 0,
    /** base + GST — what a bank transfer pays, and what a price "costs". */
    bankTotalCents: 0,
    /** base + GST + Stripe's cut — only correct when paying by card. */
    cardTotalCents: 0,
    /** "USD 0" — the list price, GST NOT included. */
    base: 'USD 0',
    /** "USD 0" — the amount owed, bare, for callers
     *  that supply their own wording (e.g. "USD 230 (incl. GST)"). */
    total: 'USD 0',
    /** "USD 0 incl. GST" — what a client will pay. */
    inclGst: 'USD 0 incl. GST',
    /** "USD 0 + GST" — when the split is stated separately. */
    plusGst: 'USD 0 + GST',
    /** "USD 0" — total when paying by card. */
    cardTotal: 'USD 0',
  },
} as const satisfies Record<string, FeeCopy>;

export type GeneratedFeeType = keyof typeof FEES;

/** The amount a client pays, spelled out — the safe default for prose. */
export function feeInclGst(type: GeneratedFeeType): string {
  return FEES[type].inclGst;
}
