import { getSessionPricing, cardChargeForHeld } from './session-pricing';
import { calculateFeeBreakdown, getFee } from '../payments/fee-config';

// PR-GST-SESSIONS — the numbers a client is actually charged for a consultation.
//
// These are written as LITERAL money, not as a re-derivation of the code under
// test. A test that recomputes the answer the same way the implementation does
// cannot catch the bug this fixes: the old module was internally consistent and
// still charged 20.00 for a 23.00 session.
//
// The literals below are the audited correct figures. If a price or the GST rate
// legitimately changes, these fail — which is the point.

describe('session pricing — what the client is charged', () => {
  it('GAP_CLOSING: 20.00 base → 23.00 wallet, 23.97 card', () => {
    const p = getSessionPricing('GAP_CLOSING');
    expect(p.baseCents).toBe(2000);
    expect(p.gstCents).toBe(300);
    expect(p.priceCents).toBe(2300);       // was 2000 — the under-charge
    expect(p.cardFeeCents).toBe(97);       // was 200 (flat 10%)
    expect(p.cardTotalCents).toBe(2397);   // was 2200
    // session-config spells it 'USD'; fee-config's own constant is 'usd'. That
    // casing split predates this fix and is passed through unchanged.
    expect(p.currency.toLowerCase()).toBe('usd');
    expect(p.paid).toBe(true);
  });

  it('LIA: 58.00 base → 66.70 wallet, 68.93 card', () => {
    const p = getSessionPricing('LIA');
    expect(p.baseCents).toBe(5800);
    expect(p.gstCents).toBe(870);
    expect(p.priceCents).toBe(6670);       // was 5800 — short by 8.70
    expect(p.cardFeeCents).toBe(223);      // was 580 (flat 10%)
    expect(p.cardTotalCents).toBe(6893);   // was 6380
  });

  it('FREE_15 stays free — no GST, no card fee', () => {
    const p = getSessionPricing('FREE_15');
    expect(p.paid).toBe(false);
    expect([p.baseCents, p.gstCents, p.priceCents, p.cardFeeCents, p.cardTotalCents])
      .toEqual([0, 0, 0, 0, 0]);
  });

  it('the card fee is Stripe\'s 2.9% + $0.30, not a flat percentage', () => {
    const gap = getSessionPricing('GAP_CLOSING');
    const lia = getSessionPricing('LIA');
    // A flat percentage would make the fee scale linearly with the price.
    // 2.9% + a fixed 30c does not: the ratio must differ.
    const gapRatio = gap.cardFeeCents / gap.priceCents;
    const liaRatio = lia.cardFeeCents / lia.priceCents;
    expect(gapRatio).not.toBeCloseTo(liaRatio, 4);
    // And explicitly: 2.9% of the GST-inclusive amount, plus 30c.
    expect(gap.cardFeeCents).toBe(Math.round(2300 * 0.029) + 30);
    expect(lia.cardFeeCents).toBe(Math.round(6670 * 0.029) + 30);
  });

  it('SESSION_CARD_FEE_PERCENT no longer influences anything', () => {
    const before = getSessionPricing('LIA');
    process.env.SESSION_CARD_FEE_PERCENT = '50';
    try {
      expect(getSessionPricing('LIA')).toEqual(before);
    } finally {
      delete process.env.SESSION_CARD_FEE_PERCENT;
    }
  });
});

describe('session pricing agrees with fee-config by construction', () => {
  // The whole point of the fix: booking and the rest of the platform cannot
  // drift, because they read the same function.
  it.each([
    { session: 'GAP_CLOSING' as const, fee: 'GAP_CLOSING' as const },
    { session: 'LIA' as const, fee: 'LIA_CONSULTATION' as const },
  ])('$session matches fee-config $fee', ({ session, fee }) => {
    const p = getSessionPricing(session);
    const f = getFee(fee);
    const bank = calculateFeeBreakdown(f.priceCents, 'bank', f.currency);
    const card = calculateFeeBreakdown(f.priceCents, 'card', f.currency);

    expect(p.priceCents).toBe(bank.totalCents);
    expect(p.cardTotalCents).toBe(card.totalCents);
    expect(p.gstCents).toBe(bank.gstCents);
  });
});

describe('an in-flight hold', () => {
  it('is charged from its own stored base, GST derived on read', () => {
    // The hold stores the PRE-GST base (the amountNZD column is unchanged by
    // this fix), so the charge must be derived, not read back raw.
    const held = cardChargeForHeld(5800, 'usd');
    expect(held.gstCents).toBe(870);
    expect(held.walletCents).toBe(6670);
    expect(held.cardFeeCents).toBe(223);
    expect(held.cardTotalCents).toBe(6893);
  });

  it('quotes the wallet and card totals a client will actually be charged', () => {
    // The pay screen shows walletCents / cardTotalCents; the wallet debit and
    // the Stripe charge must equal exactly those. Same function, so they do.
    const quoted = cardChargeForHeld(2000, 'usd');
    expect(quoted.walletCents).toBe(2300);
    expect(quoted.cardTotalCents).toBe(2397);
    expect(quoted.walletCents + quoted.cardFeeCents).toBe(quoted.cardTotalCents);
  });

  it('a zero-priced hold can never accrue a charge', () => {
    expect(cardChargeForHeld(0, 'usd')).toEqual({
      gstCents: 0, walletCents: 0, cardFeeCents: 0, cardTotalCents: 0,
    });
  });
});
