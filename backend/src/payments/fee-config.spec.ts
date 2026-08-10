import {
  getFee, getFeePriceCents, isFeeType, calculateGST, calculateCardSurcharge,
  calculateFeeBreakdown, GST_RATE, CARD_FEE_PERCENT, CARD_FEE_FIXED_CENTS, FEE_CURRENCY,
  type FeeType,
} from './fee-config';
import { getSessionConfig } from '../booking/session-config';

// PR-PHASE40 — the signed-off price table, as a test.
//
// Every figure below is the one agreed with the owner. If a price, the GST rate
// or the card-fee formula changes, this fails first and loudly — which is the
// point: these numbers end up on a tax invoice.

describe('the agreed fee table', () => {
  // base, GST, base+GST, card fee, card total, bank total — all in cents.
  const TABLE: Array<[FeeType, number, number, number, number, number, number]> = [
    ['GAP_CLOSING',            2000,  300,  2300,  97,  2397,  2300],
    ['ADMISSION_CONSULTATION', 5000,  750,  5750, 197,  5947,  5750],
    ['LIA_CONSULTATION',       5800,  870,  6670, 223,  6893,  6670],
    ['ACCOUNT_OPENING',       20000, 3000, 23000, 697, 23697, 23000],
  ];

  it.each(TABLE)(
    '%s: base %i → GST %i → +GST %i → card fee %i → card %i / bank %i',
    (type, base, gst, withGst, cardFee, cardTotal, bankTotal) => {
      expect(getFeePriceCents(type)).toBe(base);
      expect(calculateGST(base)).toBe(gst);
      expect(calculateCardSurcharge(base)).toBe(cardFee);

      const card = calculateFeeBreakdown(base, 'card');
      expect(card.gstCents).toBe(gst);
      expect(card.subtotalWithGstCents).toBe(withGst);
      expect(card.cardFeeCents).toBe(cardFee);
      expect(card.totalCents).toBe(cardTotal);

      const bank = calculateFeeBreakdown(base, 'bank');
      expect(bank.cardFeeCents).toBe(0);
      expect(bank.totalCents).toBe(bankTotal);
    },
  );

  it('FREE_15 costs nothing and accrues neither tax nor fee', () => {
    expect(getFeePriceCents('FREE_15')).toBe(0);
    expect(calculateGST(0)).toBe(0);
    expect(calculateCardSurcharge(0)).toBe(0);
    expect(calculateFeeBreakdown(0, 'card').totalCents).toBe(0);
  });
});

describe('the bookable fees come FROM session-config, not a copy', () => {
  // The whole reason this module exists is that two tables disagreed. Copying
  // the numbers here would recreate that.
  it.each([
    ['GAP_CLOSING', 'GAP_CLOSING'],
    ['LIA_CONSULTATION', 'LIA'],
    ['FREE_15', 'FREE_15'],
  ] as const)('%s tracks session-config %s', (feeType, sessionType) => {
    const cfg = getSessionConfig(sessionType);
    expect(getFeePriceCents(feeType as FeeType)).toBe(Math.round(cfg.price * 100));
    expect(getFee(feeType as FeeType).currency).toBe(cfg.currency.toLowerCase());
  });

  it('everything is USD — no NZD survives anywhere in the table', () => {
    const all: FeeType[] = ['FREE_15', 'GAP_CLOSING', 'LIA_CONSULTATION', 'ADMISSION_CONSULTATION', 'ACCOUNT_OPENING'];
    for (const t of all) expect(getFee(t).currency).toBe('usd');
    expect(FEE_CURRENCY).toBe('usd');
  });
});

describe('the arithmetic itself', () => {
  it('applies GST to the base, then the card fee to base + GST — never the other order', () => {
    // If the fee were charged on the base alone the answer would be smaller;
    // this pins the ORDER, not just the result.
    const base = 20000;
    const wrongOrder = Math.round(base * CARD_FEE_PERCENT) + CARD_FEE_FIXED_CENTS; // 610
    expect(calculateCardSurcharge(base)).toBe(697);
    expect(calculateCardSurcharge(base)).not.toBe(wrongOrder);
  });

  it('works in integer cents, so no fractional cent can reach an invoice', () => {
    // 0.15 * a float dollar is where this normally goes wrong.
    for (const cents of [1, 7, 33, 199, 12345]) {
      expect(Number.isInteger(calculateGST(cents))).toBe(true);
      expect(Number.isInteger(calculateCardSurcharge(cents))).toBe(true);
    }
    expect(calculateGST(7)).toBe(1);      // 1.05 → 1
    expect(calculateGST(33)).toBe(5);     // 4.95 → 5
  });

  it('never charges tax or fees on a zero or negative amount', () => {
    for (const n of [0, -1, -5000]) {
      expect(calculateGST(n)).toBe(0);
      expect(calculateCardSurcharge(n)).toBe(0);
    }
  });

  it('bank transfer never carries a card fee', () => {
    const b = calculateFeeBreakdown(20000, 'bank');
    expect(b.cardFeeCents).toBe(0);
    expect(b.totalCents).toBe(b.baseCents + b.gstCents);
  });

  it('holds the agreed rates', () => {
    expect(GST_RATE).toBe(0.15);
    expect(CARD_FEE_PERCENT).toBe(0.029);
    expect(CARD_FEE_FIXED_CENTS).toBe(30);
  });
});

describe('fee type guard', () => {
  it('accepts every real type and rejects anything else', () => {
    for (const t of ['FREE_15', 'GAP_CLOSING', 'LIA_CONSULTATION', 'ADMISSION_CONSULTATION', 'ACCOUNT_OPENING']) {
      expect(isFeeType(t)).toBe(true);
    }
    // ACCOUNT_REACTIVATION is a future phase — it must NOT silently resolve yet.
    for (const t of ['ACCOUNT_REACTIVATION', 'LIA', 'nonsense', '']) {
      expect(isFeeType(t)).toBe(false);
    }
    expect(() => getFee('ACCOUNT_REACTIVATION' as FeeType)).toThrow();
  });
});
