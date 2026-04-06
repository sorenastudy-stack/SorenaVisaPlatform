import { Controller, Post, Get, Body, Req, Param, UseGuards, RawBodyRequest } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import Stripe from 'stripe';

@Controller('payments')
export class PaymentsController {
  constructor(
    private stripeService: StripeService,
    private subscriptionsService: SubscriptionsService,
    private eventsService: EventsService,
    private prisma: PrismaService,
  ) {}

  /**
   * Create checkout session for subscription
   */
  @Post('subscription/checkout')
  @UseGuards(JwtAuthGuard)
  async createSubscriptionCheckout(
    @Body('leadId') leadId: string,
    @Body('plan') plan: 'BASIC' | 'PRO' | 'PREMIUM',
    @Body('amountNZD') amountNZD: number,
  ) {
    // Create subscription record
    await this.subscriptionsService.createSubscription(leadId, plan);

    // Create Stripe checkout session
    const session = await this.stripeService.createCheckoutSession(
      leadId,
      plan,
      amountNZD,
    );

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  /**
   * Create checkout session for consultation
   */
  @Post('consultation/checkout')
  @UseGuards(JwtAuthGuard)
  async createConsultationCheckout(
    @Body('leadId') leadId: string,
    @Body('type') type: 'ADMISSION' | 'LIA',
  ) {
    const amounts = {
      ADMISSION: 50,
      LIA: 200,
    };

    const session = await this.stripeService.createOneTimePayment(
      leadId,
      type,
      amounts[type],
    );

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  /**
   * Handle Stripe webhooks
   */
  @Post('webhook')
  async handleWebhook(
    @Req() req: RawBodyRequest<any>,
  ) {
    const signature = req.headers['stripe-signature'] as string;

    let event: any;
    try {
      event = this.stripeService.constructWebhookEvent(
        req.rawBody,
        signature,
      );
    } catch (error) {
      return { error: error.message };
    }

    // Handle payment_intent.succeeded
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      await this.handlePaymentSucceeded(paymentIntent);
    }

    // Handle subscription updated
    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      await this.handleSubscriptionUpdated(subscription);
    }

    // Handle subscription deleted
    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      await this.handleSubscriptionDeleted(subscription);
    }

    return { received: true };
  }

  /**
   * Handle payment succeeded webhook
   */
  private async handlePaymentSucceeded(paymentIntent: any) {
    if (!paymentIntent.metadata?.leadId) return;

    const leadId = paymentIntent.metadata.leadId;

    // Check if it's a consultation or subscription payment
    if (paymentIntent.metadata?.paymentType === 'consultation') {
      // Mark consultation as paid - would need additional logic here
      const consultationType = paymentIntent.metadata.type as 'ADMISSION' | 'LIA';

      // Emit event
      await this.eventsService.emit(
        'CONSULTATION_PAYMENT_CONFIRMED',
        'CONSULTATION',
        paymentIntent.id,
        leadId,
        'SYSTEM',
        null,
        { type: consultationType, amount: paymentIntent.amount_received },
      );
    } else {
      // Handle subscription payment
      const plan = paymentIntent.metadata.plan as 'BASIC' | 'PRO' | 'PREMIUM';

      // Activate subscription
      await this.subscriptionsService.activateSubscription(
        leadId,
        paymentIntent.id,
      );

      // Emit event
      await this.eventsService.emit(
        'PAYMENT_CONFIRMED',
        'SUBSCRIPTION',
        paymentIntent.id,
        leadId,
        'SYSTEM',
        null,
        { plan, amount: paymentIntent.amount_received },
      );
    }
  }

  /**
   * Handle subscription updated webhook
   */
  private async handleSubscriptionUpdated(subscription: any) {
    // Get the subscription from our database by Stripe ID
    const dbSubscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!dbSubscription) return;

    // Update status based on Stripe status
    const statusMap: Record<string, 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'CANCELLED'> = {
      'active': 'ACTIVE',
      'past_due': 'PAUSED',
      'unpaid': 'PAUSED',
      'canceled': 'CANCELLED',
    };

    const newStatus = statusMap[subscription.status] || 'ACTIVE';

    await this.prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: { status: newStatus },
    });

    // Emit event
    await this.eventsService.emit(
      'SUBSCRIPTION_UPDATED',
      'SUBSCRIPTION',
      subscription.id,
      dbSubscription.leadId,
      'SYSTEM',
      null,
      { stripeStatus: subscription.status, newStatus },
    );
  }

  /**
   * Handle subscription deleted webhook
   */
  private async handleSubscriptionDeleted(subscription: any) {
    // Get subscription from database
    const dbSubscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!dbSubscription) return;

    // Expire the subscription
    await this.subscriptionsService.expireSubscription(dbSubscription.leadId);
  }
}
