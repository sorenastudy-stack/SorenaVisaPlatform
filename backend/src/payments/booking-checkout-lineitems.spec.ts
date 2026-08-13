import { StripeService } from './stripe.service';
import { cardChargeForHeld } from '../booking/session-pricing';

// PR-GST-SESSIONS — the money that actually reaches Stripe.
//
// The unit tests cover the arithmetic and the HTTP check covers what the
// booking page is told, but neither proves what is CHARGED. This captures the
// real line items the checkout session would be created with, by stubbing only
// the Stripe client itself — the service's own logic runs untouched.
//
// A dev environment has no adviser availability, so a hold cannot be created
// over HTTP; this is how the charge path is verified instead.

describe('booking checkout — the line items Stripe is sent', () => {
  let service: StripeService;
  let created: any;

  beforeEach(() => {
    service = new StripeService();
    created = null;
    (service as any).stripe = {
      checkout: { sessions: { create: async (args: any) => { created = args; return { url: 'https://stripe.test/s' }; } } },
    };
  });

  it('charges base + GST + card fee for an LIA hold — 68.93 total', async () => {
    // 5800 is the hold's stored PRE-GST base, exactly as the column holds it.
    const { gstCents, cardFeeCents } = cardChargeForHeld(5800, 'USD');

    await service.createBookingCheckoutSession({
      consultationId: 'c1', leadId: 'l1', bookingType: 'LIA', currency: 'USD',
      baseCents: 5800, gstCents, cardFeeCents, productName: 'Sorena Visa — LIA Consultation',
    });

    const items = created.line_items;
    expect(items.map((i: any) => [i.price_data.product_data.name, i.price_data.unit_amount])).toEqual([
      ['Sorena Visa — LIA Consultation', 5800],
      ['GST 15%', 870],
      ['Card processing fee', 223],
    ]);
    const total = items.reduce((s: number, i: any) => s + i.price_data.unit_amount * i.quantity, 0);
    expect(total).toBe(6893);   // was 6380 — no GST, flat 10% fee
  });

  it('charges 23.97 for a Gap-Closing hold', async () => {
    const { gstCents, cardFeeCents } = cardChargeForHeld(2000, 'USD');
    await service.createBookingCheckoutSession({
      consultationId: 'c2', leadId: 'l1', bookingType: 'GAP_CLOSING', currency: 'USD',
      baseCents: 2000, gstCents, cardFeeCents, productName: 'Sorena Visa — Gap-Closing Session',
    });
    const total = created.line_items.reduce(
      (s: number, i: any) => s + i.price_data.unit_amount * i.quantity, 0);
    expect(total).toBe(2397);   // was 2200
    expect(created.line_items).toHaveLength(3);
  });

  it('omits the GST line entirely when there is no GST', async () => {
    await service.createBookingCheckoutSession({
      consultationId: 'c3', leadId: 'l1', bookingType: 'FREE_15', currency: 'USD',
      baseCents: 0, gstCents: 0, cardFeeCents: 0, productName: 'Sorena Visa — Free 15',
    });
    expect(created.line_items).toHaveLength(1);
  });

  it('itemises rather than grossing up, so the client can reconcile it', async () => {
    const { gstCents, cardFeeCents } = cardChargeForHeld(5800, 'USD');
    await service.createBookingCheckoutSession({
      consultationId: 'c4', leadId: 'l1', bookingType: 'LIA', currency: 'USD',
      baseCents: 5800, gstCents, cardFeeCents, productName: 'X',
    });
    // Three separate prices, not one 6893 line — matching the account-opening
    // payment link, and required for GST to be visible.
    expect(created.line_items).toHaveLength(3);
    expect(created.line_items.some((i: any) => i.price_data.unit_amount === 6893)).toBe(false);
  });
});
