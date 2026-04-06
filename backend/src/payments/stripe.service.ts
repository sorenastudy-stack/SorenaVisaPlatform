import { Injectable, BadRequestException } from '@nestjs/common';

const Stripe = require('stripe');

@Injectable()
export class StripeService {
  private stripe: any;

  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
  }

  /**
   * Create a checkout session for subscription
   */
  async createCheckoutSession(
    leadId: string,
    plan: 'BASIC' | 'PRO' | 'PREMIUM',
    amountNZD: number,
  ) {
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
   * Construct and verify webhook event
   */
  constructWebhookEvent(payload: Buffer, signature: string) {
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
    return this.stripe.paymentIntents.retrieve(paymentIntentId);
  }

  /**
   * Retrieve a customer
   */
  async getCustomer(customerId: string) {
    return this.stripe.customers.retrieve(customerId);
  }

  /**
   * Retrieve a subscription
   */
  async getSubscription(subscriptionId: string) {
    return this.stripe.subscriptions.retrieve(subscriptionId);
  }
}
