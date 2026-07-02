import { Injectable, BadRequestException, Logger } from '@nestjs/common';

const Stripe = require('stripe');

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: any = null;

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      this.logger.warn('STRIPE_SECRET_KEY is not set — payment features will be unavailable');
    } else {
      this.stripe = new Stripe(key);
    }
  }

  private assertConfigured(): void {
    if (!this.stripe) {
      throw new BadRequestException('Stripe is not configured — STRIPE_SECRET_KEY is missing');
    }
  }

  /**
   * Create a checkout session for subscription
   */
  async createCheckoutSession(
    leadId: string,
    plan: 'BASIC' | 'PRO' | 'PREMIUM',
    amountNZD: number,
  ) {
    this.assertConfigured();
    const prices: Record<string, number> = {
      BASIC: 2999, // $29.99 NZD
      PRO: 4999, // $49.99 NZD
      PREMIUM: 9999, // $99.99 NZD
    };

    const amount = prices[plan] || amountNZD * 100; // Convert to cents

    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: 'nzd',
            product_data: {
              name: `${plan} Subscription`,
              description: `Sorena Visa Platform - ${plan} Plan`,
            },
            unit_amount: amount,
            recurring: {
              interval: 'month',
              interval_count: 1,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        leadId,
        plan,
      },
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/cancel`,
    });

    return session;
  }

  /**
   * Create one-time payment for consultation
   */
  async createOneTimePayment(
    leadId: string,
    type: 'ADMISSION' | 'LIA',
    amountNZD: number,
  ) {
    this.assertConfigured();
    const amounts: Record<string, number> = {
      ADMISSION: 5000, // $50 NZD in cents
      LIA: 20000, // $200 NZD in cents
    };

    const amount = amounts[type] || amountNZD * 100;

    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'nzd',
            product_data: {
              name: `${type} Consultation`,
              description: `Sorena Visa Platform - ${type} Consultation Fee`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        leadId,
        type,
        paymentType: 'consultation',
      },
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/cancel`,
    });

    return session;
  }

  /**
   * Create a Stripe Payment Link for a consultation booking
   */
  async createConsultationPaymentLink(
    leadId: string,
    consultationType: string,
    amountNZD: number,
    currency: string = 'nzd',
    // PR-LIA-AUTO-ASSIGN — optional caseId to plumb through the Stripe
    // link metadata. The webhook handler reads this to know which case
    // to assign an LIA to on ACCOUNT_OPENING success. Existing callers
    // (consultation bookings without a case) continue to work unchanged.
    caseId?: string,
  ) {
    this.assertConfigured();
    const amountCents = Math.round(amountNZD * 100);

    // `stripe.prices.create` accepts an inline `product_data` whose schema is
    // narrower than the one used by Checkout Sessions: it allows `name`,
    // `id`, `active`, `metadata`, `statement_descriptor`, `tax_code`,
    // `unit_label` — but NOT `description`. Passing description here
    // surfaces "Received unknown parameter: product_data[description]"
    // from the Stripe SDK. The customer-facing label is the product
    // `name`, which already renders the friendly type (e.g. "Admission
    // Consultation") on the hosted Payment Link page.
    const price = await this.stripe.prices.create({
      currency,
      unit_amount: amountCents,
      product_data: {
        name: consultationType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase()),
      },
    });

    // PR-LIA-AUTO-ASSIGN — when this is the $200 account-opening charge,
    // tag the metadata with paymentType: 'ACCOUNT_OPENING' so the
    // webhook handler can route it past the consultation/subscription
    // branches into the new auto-assign path.
    const metadata: Record<string, string> = { leadId, consultationType };
    if (caseId) metadata.caseId = caseId;
    if (consultationType === 'ACCOUNT_OPENING') {
      metadata.paymentType = 'ACCOUNT_OPENING';
    } else {
      // PR-PAYMENTS-RECEIPT — non-ACCOUNT_OPENING consultation links now
      // carry the discriminator the webhook reads to route into the
      // payment-received-email branch. Before this, only the legacy
      // /consultation/checkout Checkout Session set paymentType =
      // 'consultation'; the real, in-use Payment Links left it
      // undefined and fell through to the subscription branch.
      metadata.paymentType = 'consultation';
      metadata.type = consultationType;
    }

    // Stripe treats Payment Link metadata and PaymentIntent metadata as
    // SEPARATE buckets. Top-level `metadata` stays on the Payment Link
    // object; the PaymentIntent created when a customer pays inherits
    // NOTHING from it. To make the webhook's `paymentIntent.metadata`
    // carry `leadId` / `caseId` / `paymentType`, we must ALSO set the
    // same fields under `payment_intent_data.metadata`. Without this,
    // `handlePaymentSucceeded` hits `if (!paymentIntent.metadata?.leadId)
    // return;` and silently no-ops — the webhook 200s, no Payment row
    // is written, no Payment appears on the case. We keep top-level
    // metadata too so the link stays searchable in the Stripe Dashboard.
    const paymentLink = await this.stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
      payment_intent_data: {
        metadata,
      },
      after_completion: {
        type: 'redirect',
        redirect: {
          url: `${process.env.FRONTEND_URL || 'https://sorenastudy.com'}/payment/success`,
        },
      },
    });

    return paymentLink;
  }

  /**
   * Create a Stripe Payment Link for a CUSTOM amount on a case.
   *
   * Distinct from createConsultationPaymentLink in two ways:
   *   1. Inline `line_items[].price_data` — no `prices.create` call.
   *      Each custom-amount link is bespoke; persisting a Stripe Price
   *      per send would just clutter the dashboard.
   *   2. No `consultationType` discriminator on metadata — this isn't a
   *      consultation, just a generic case-attached service payment.
   *      `paymentType` is also deliberately omitted to mirror the
   *      existing non-ACCOUNT_OPENING consultation flow.
   *
   * Same metadata propagation pattern as f751833 (the consultation
   * flow fix): top-level `metadata` AND `payment_intent_data.metadata`
   * both carry `{ leadId, caseId }` so the webhook handler reads them
   * off `paymentIntent.metadata` and records the resulting Payment row
   * against the correct case. Same after_completion redirect.
   *
   * Product name on the hosted Stripe page reads "Sorena Visa – Service
   * Payment" (per the staff-spec for this flow) — the customer doesn't
   * see the consultation-type-style label because there isn't one.
   */
  async createCustomAmountPaymentLink(
    leadId:      string,
    caseId:      string,
    amountCents: number,
    currency:    string = 'nzd',
  ) {
    this.assertConfigured();

    // PR-PAYMENTS-RECEIPT — tag the custom-amount link with the same
    // discriminator the consultation flow uses, so the webhook handler
    // routes a successful payment into the receipt-email branch. The
    // generic 'CUSTOM_AMOUNT' type is recorded but no longer surfaces
    // in the client email (the receipt copy is type-agnostic).
    const metadata: Record<string, string> = {
      leadId,
      caseId,
      paymentType: 'consultation',
      type:        'CUSTOM_AMOUNT',
    };

    const paymentLink = await this.stripe.paymentLinks.create({
      line_items: [{
        price_data: {
          currency,
          unit_amount: amountCents,
          product_data: {
            name: 'Sorena Visa – Service Payment',
          },
        },
        quantity: 1,
      }],
      metadata,
      payment_intent_data: {
        metadata,
      },
      after_completion: {
        type: 'redirect',
        redirect: {
          url: `${process.env.FRONTEND_URL || 'https://sorenastudy.com'}/payment/success`,
        },
      },
    });

    return paymentLink;
  }

  /**
   * PR-BOOKING-4 — Stripe Checkout Session for a HELD booking slot.
   *
   * Hosted Checkout (mode 'payment'). Price comes from the caller
   * (session-config, NOT the legacy amount maps). CRITICAL: metadata is
   * set on BOTH the session `metadata` AND `payment_intent_data.metadata`
   * — the webhook reads `paymentIntent.metadata`, which does NOT inherit
   * the session metadata. `consultationId` is what lets the webhook find
   * and confirm THIS held consultation.
   */
  async createBookingCheckoutSession(params: {
    consultationId: string;
    leadId: string;
    bookingType: string; // e.g. 'GAP_CLOSING'
    amountCents: number;
    productName: string;
  }) {
    this.assertConfigured();
    const metadata: Record<string, string> = {
      leadId: params.leadId,
      consultationId: params.consultationId,
      paymentType: 'booking',
      bookingType: params.bookingType,
    };
    const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
    // Return the user to the right booking page on cancel (gap / lia).
    const cancelType = params.bookingType === 'LIA' ? 'lia' : 'gap';
    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'nzd',
            product_data: { name: params.productName },
            unit_amount: params.amountCents,
          },
          quantity: 1,
        },
      ],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${frontend}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontend}/portal/booking?type=${cancelType}`,
    });
    return session;
  }

  /**
   * Construct and verify webhook event
   */
  constructWebhookEvent(payload: Buffer, signature: string) {
    this.assertConfigured();
    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET || '',
      );
      return event;
    } catch (error) {
      throw new BadRequestException(`Webhook signature verification failed: ${error.message}`);
    }
  }

  /**
   * Retrieve a payment intent
   */
  async getPaymentIntent(paymentIntentId: string) {
    this.assertConfigured();
    return this.stripe.paymentIntents.retrieve(paymentIntentId);
  }

  /**
   * PR-CARD-REFUND — issue a real refund against the original PaymentIntent.
   * `amountCents` is integer cents (must be <= captured). The idempotencyKey
   * makes a retry/double-submit return the SAME Stripe refund instead of
   * issuing a second one — critical, this is real money. Our free-text reason
   * goes in metadata (Stripe's own `reason` is a restricted enum we don't set).
   * Returns the Stripe Refund object ({ id, status, ... }).
   */
  async createRefund(params: {
    paymentIntentId: string;
    amountCents: number;
    idempotencyKey: string;
    reason?: string;
  }) {
    this.assertConfigured();
    if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) {
      throw new BadRequestException('Refund amount must be a positive integer (cents)');
    }
    return this.stripe.refunds.create(
      {
        payment_intent: params.paymentIntentId,
        amount: params.amountCents,
        ...(params.reason ? { metadata: { reason: params.reason.slice(0, 500) } } : {}),
      },
      { idempotencyKey: params.idempotencyKey },
    );
  }

  /**
   * Retrieve a customer
   */
  async getCustomer(customerId: string) {
    this.assertConfigured();
    return this.stripe.customers.retrieve(customerId);
  }

  /**
   * Retrieve a subscription
   */
  async getSubscription(subscriptionId: string) {
    this.assertConfigured();
    return this.stripe.subscriptions.retrieve(subscriptionId);
  }
}
