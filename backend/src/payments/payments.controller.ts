import { Controller, Post, Get, Body, Req, Param, UseGuards, RawBodyRequest, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LiaAssignmentService } from '../cases/lia-assignment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { RecordManualPaymentDto } from './dto/record-manual-payment.dto';
import Stripe from 'stripe';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private stripeService: StripeService,
    private paymentsService: PaymentsService,
    private subscriptionsService: SubscriptionsService,
    private eventsService: EventsService,
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    // PR-LIA-AUTO-ASSIGN — auto-assign an LIA when the $200 ACCOUNT_OPENING
    // charge succeeds and the matching case has a signed contract.
    private liaAssignments: LiaAssignmentService,
  ) {}

  /**
   * Create a Stripe Payment Link for a consultation.
   *
   * Now DTO-validated: leadId must be a non-empty string and
   * consultationType must be one of the five known keys (see
   * CONSULTATION_TYPES). The global ValidationPipe rejects malformed
   * requests with 400 before the service runs — closes the audit
   * gap noted in the Phase 6 doc.
   */
  @Post('consultation-link')
  @UseGuards(JwtAuthGuard)
  async createConsultationLink(@Body() dto: CreatePaymentLinkDto) {
    return this.paymentsService.createConsultationPaymentLink(
      dto.leadId,
      dto.consultationType,
    );
  }

  /**
   * List payments tied to a case — both directly (Payment.caseId) and
   * indirectly through the lead (consultation/subscription rows where
   * Payment.caseId is NULL but Payment.lead.cases includes this case).
   * Staff-only.
   */
  @Get('case/:caseId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE')
  async listPaymentsForCase(@Param('caseId') caseId: string) {
    return this.paymentsService.listPaymentsForCase(caseId);
  }

  /**
   * Record a manual (cash / wire / cheque) payment on a case. Writes
   * one Payment row + one AuditLog row in a single transaction. Staff-only.
   */
  @Post('case/:caseId/manual')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE')
  async recordManualPayment(
    @Param('caseId') caseId: string,
    @Body() dto: RecordManualPaymentDto,
    @Req() req: any,
  ) {
    const actor = {
      id:   req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
    return this.paymentsService.recordManualPayment(caseId, dto, actor);
  }

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
  // Stripe retries failed deliveries with exponential backoff for ~3 days
  // and eventually gives up; a 429 from the global ThrottlerGuard would
  // risk losing payment events. Stripe-signature verification still
  // protects this endpoint.
  @SkipThrottle()
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

    // Get lead with contact info
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { contact: true },
    });

    if (!lead) return;

    // PR-LIA-AUTO-ASSIGN Phase 6 — durable payment record + Stripe-retry
    // idempotency. Written BEFORE the per-paymentType branches so a
    // retried webhook short-circuits the whole handler (no double email,
    // no double subscription activation, no double assignLiaToCase).
    // The @unique constraint on stripePaymentIntentId is the lock.
    try {
      await this.prisma.payment.create({
        data: {
          stripePaymentIntentId: paymentIntent.id,
          leadId,
          caseId: (paymentIntent.metadata?.caseId as string | undefined) ?? null,
          paymentType: (paymentIntent.metadata?.paymentType as string | undefined) ?? 'unknown',
          amount: paymentIntent.amount_received,
          currency: paymentIntent.currency ?? 'nzd',
          status: 'succeeded',
          metadata: paymentIntent.metadata ?? {},
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Stripe retried — payment already recorded, idempotent skip.
        this.logger.log(
          `Stripe webhook retry for paymentIntent ${paymentIntent.id} — payment already recorded, skipping`,
        );
        return;
      }
      throw err;
    }

    // Check if it's a consultation or subscription payment
    if (paymentIntent.metadata?.paymentType === 'consultation') {
      // Mark consultation as paid - would need additional logic here
      const consultationType = paymentIntent.metadata.type as 'ADMISSION' | 'LIA';

      // Send consultation confirmation email
      await this.notificationsService.sendConsultationConfirmation(
        lead.contact.email,
        lead.contact.fullName,
        'ASAP', // Placeholder - in real implementation, get actual date
        consultationType,
      );

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
    } else if (paymentIntent.metadata?.paymentType === 'ACCOUNT_OPENING') {
      // PR-LIA-AUTO-ASSIGN, Phase 3 — log + emit the domain event so the
      // rest of the pipeline (timeline, downstream listeners) has the signal
      // even when caseId is missing or the contract isn't yet signed.
      const caseId = (paymentIntent.metadata?.caseId as string | undefined) ?? null;
      this.logger.log(
        `ACCOUNT_OPENING payment succeeded for lead ${leadId}${caseId ? ` (case ${caseId})` : ' (no caseId in metadata)'} — paymentIntent ${paymentIntent.id}`,
      );

      await this.eventsService.emit(
        'ACCOUNT_OPENING_CONFIRMED',
        'ACCOUNT_OPENING',
        paymentIntent.id,
        leadId,
        'SYSTEM',
        null,
        { caseId, amount: paymentIntent.amount_received },
      );

      // PR-LIA-AUTO-ASSIGN, Phase 4 — fire LIA auto-assignment when
      // ACCOUNT_OPENING payment succeeds AND the contract for this case is
      // signed. Sign-first-then-pay workflow: payment is the LAST event.
      // Defensive: use signedAt IS NOT NULL (not status === 'SIGNED') to
      // survive the ContractStatus enum mismatch (fixed in Phase 5).
      // Mirrors the contracts.service.ts:120-137 pattern: try/catch with
      // logger; failures never block the webhook response; the underlying
      // assignLiaToCase service is idempotent on already-assigned cases.
      if (paymentIntent.metadata.caseId) {
        try {
          const targetCaseId = paymentIntent.metadata.caseId as string;
          const contract = await this.prisma.contract.findFirst({
            where: { caseId: targetCaseId, signedAt: { not: null } },
          });
          if (contract) {
            const result = await this.liaAssignments.assignLiaToCase(targetCaseId);
            if (result.status === 'assigned') {
              this.logger.log(
                `LIA ${result.liaName} (${result.liaId}) auto-assigned to case ${targetCaseId} on ACCOUNT_OPENING payment`,
              );
            } else if (result.status === 'no_candidates') {
              this.logger.warn(
                `ACCOUNT_OPENING payment for case ${targetCaseId} confirmed but no active LIAs available — case left unassigned`,
              );
            }
          } else {
            this.logger.warn(
              `ACCOUNT_OPENING payment received but contract not yet signed for case ${targetCaseId} — assignment deferred`,
            );
          }
        } catch (err: any) {
          this.logger.error(
            `LIA auto-assignment failed for case ${paymentIntent.metadata.caseId}: ${err?.message ?? err}`,
          );
        }
      }
    } else {
      // Handle subscription payment. Note: pre-PR-LIA-AUTO-ASSIGN this branch
      // also (incorrectly) swallowed ACCOUNT_OPENING webhooks because the
      // metadata never carried paymentType. With Phase 2 + Phase 3 in place,
      // ACCOUNT_OPENING is routed above and this branch is subscription-only.
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
