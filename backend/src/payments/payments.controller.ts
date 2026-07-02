import { Controller, Post, Get, Body, Req, Param, UseGuards, RawBodyRequest, Logger, BadRequestException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { LiaAssignmentService } from '../cases/lia-assignment.service';
import { BookingConfirmationService } from '../booking/booking-confirmation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { CreateCaseConsultationLinkDto } from './dto/create-case-consultation-link.dto';
import { CreateCaseCustomLinkDto } from './dto/create-case-custom-link.dto';
import { RecordManualPaymentDto } from './dto/record-manual-payment.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { RejectPaymentDto } from './dto/reject-payment.dto';
import { Prisma } from '@prisma/client';
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
    private mail: MailService,
    // PR-LIA-AUTO-ASSIGN — auto-assign an LIA when the $200 ACCOUNT_OPENING
    // charge succeeds and the matching case has a signed contract.
    private liaAssignments: LiaAssignmentService,
    // PR-BOOKING-5 — finalize a confirmed paid booking (Jitsi link + email).
    private bookingConfirmation: BookingConfirmationService,
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
   * Case-keyed consultation link — staff Payments-tab convenience.
   * Resolves leadId server-side from caseId and forwards to the same
   * Stripe flow as POST /payments/consultation-link. The caseId is
   * threaded into the Stripe link metadata so the post-payment webhook
   * ties the resulting Payment row directly to the case (mirrors
   * ACCOUNT_OPENING). Staff-only.
   *
   * NOTE: POST /payments/consultation-link still exists and is unchanged
   * — other callers (lead-detail flows) keep using the leadId-keyed route.
   */
  @Post('case/:caseId/consultation-link')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE')
  async createCaseConsultationLink(
    @Param('caseId') caseId: string,
    @Body() dto: CreateCaseConsultationLinkDto,
  ) {
    return this.paymentsService.createConsultationLinkForCase(
      caseId,
      dto.consultationType,
    );
  }

  /**
   * Case-keyed CUSTOM-amount payment link — staff Payments tab,
   * sibling of consultation-link. Same role list, same case-keyed
   * URL shape, same metadata propagation behavior (the staff UI
   * needs an arbitrary-amount link for one-off invoices). The amount
   * is integer cents on the wire — the frontend converts the
   * dollar-typed input via EPSILON-safe Math.round before sending.
   */
  @Post('case/:caseId/custom-link')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE')
  async createCaseCustomLink(
    @Param('caseId') caseId: string,
    @Body() dto: CreateCaseCustomLinkDto,
  ) {
    return this.paymentsService.createCustomLinkForCase(
      caseId,
      dto.amount,
      (dto.currency ?? 'nzd').toLowerCase(),
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
   * Phase 6.5 — finance verification: confirm a payment.
   *
   * Roles are intentionally NARROWER than the rest of the staff
   * Payments tab: confirming a payment as real is a privileged
   * finance action. SUPPORT / CONSULTANT / LIA can see the row but
   * not approve it.
   */
  @Post(':paymentId/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'FINANCE')
  async confirmPayment(
    @Param('paymentId') paymentId: string,
    @Body() dto: VerifyPaymentDto,
    @Req() req: any,
  ) {
    const actor = {
      id:   req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
    return this.paymentsService.confirmPayment(paymentId, actor, dto.note);
  }

  /**
   * Phase 6.5 — finance verification: reject a payment.
   *
   * Same narrow role list as confirm. The reason (dto.note) is
   * REQUIRED at the DTO level AND re-checked in the service so the
   * audit trail always has a `why`.
   */
  @Post(':paymentId/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'FINANCE')
  async rejectPayment(
    @Param('paymentId') paymentId: string,
    @Body() dto: RejectPaymentDto,
    @Req() req: any,
  ) {
    const actor = {
      id:   req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
    return this.paymentsService.rejectPayment(paymentId, actor, dto.note);
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
      // Signature verification failed. Return 400 (NOT 201) so the failure
      // is visible in `stripe listen` and Stripe retries delivery. Returning
      // a 2xx here previously masked secret-mismatch / raw-body problems.
      this.logger.warn(`Stripe webhook signature verification failed: ${error.message}`);
      throw new BadRequestException(`Webhook signature verification failed`);
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
          // Phase 6.5 — finance must still sign off on Stripe payments.
          // Set explicitly (even though PENDING is the column default)
          // so the intent is obvious to anyone reading this critical
          // money path and so a future schema-default change doesn't
          // silently flip this branch's behaviour.
          verificationStatus: 'PENDING',
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

      // Send payment-received email (Phase 6 follow-up — no meeting
      // date is available at this point in the flow; staff book the
      // session out-of-band after the payment lands). Pass the
      // amount, currency, and paymentIntent id so the email carries
      // a real receipt + a reference the client can quote back to
      // finance.
      await this.mail.sendConsultationConfirmation(
        lead.contact.email,
        lead.contact.fullName,
        paymentIntent.amount_received,
        paymentIntent.currency ?? 'nzd',
        consultationType,
        paymentIntent.id,
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
    } else if (paymentIntent.metadata?.paymentType === 'booking') {
      // PR-BOOKING-4 — paid booking (GAP_CLOSING slice). Confirm the held
      // consultation referenced by metadata.consultationId.
      await this.confirmHeldBookingPayment(paymentIntent);
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
   * PR-BOOKING-4 — confirm a held paid booking on payment success.
   *
   * Flips the held PENDING consultation → CONFIRMED + paymentStatus PAID.
   * Idempotency for Stripe retries is already handled upstream by the
   * Payment.create @unique guard (this runs at most once per intent); the
   * already-CONFIRMED short-circuit is a second line of defence.
   *
   * PAID-NO-SLOT: if the hold lapsed and another confirmed booking took the
   * adviser+slot, the confirm flip would double-book. We detect that (re-
   * check + the partial unique index) and instead keep the payment, mark it
   * PAID, drop the lost slot, and flag for staff refund/rebook — never lose
   * the money. (Email/staff notification is a TODO in this slice — logged.)
   */
  private async confirmHeldBookingPayment(paymentIntent: any) {
    const consultationId = paymentIntent.metadata?.consultationId as string | undefined;
    if (!consultationId) {
      this.logger.warn(`booking webhook ${paymentIntent.id}: no consultationId in metadata — skipping`);
      return;
    }
    const consult = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      select: { id: true, status: true, assignedToId: true, scheduledAt: true, scheduledEndAt: true, leadId: true },
    });
    if (!consult) {
      this.logger.warn(`booking webhook: consultation ${consultationId} not found`);
      return;
    }
    if (consult.status === 'CONFIRMED') {
      return; // idempotent — already confirmed
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Did another confirmed booking take this adviser+slot while the
        // hold lapsed? (The partial unique index is the ultimate guard; this
        // re-check gives a clean branch.)
        if (consult.assignedToId && consult.scheduledAt && consult.scheduledEndAt) {
          const clash = await tx.consultation.findFirst({
            where: {
              assignedToId: consult.assignedToId,
              id: { not: consult.id },
              status: { in: ['BOOKED', 'CONFIRMED'] },
              scheduledAt: { not: null, lt: consult.scheduledEndAt },
              scheduledEndAt: { gt: consult.scheduledAt },
            },
            select: { id: true },
          });
          if (clash) {
            const err: any = new Error('slot lost');
            err.__slotLost = true;
            throw err;
          }
        }
        await tx.consultation.update({
          where: { id: consult.id },
          // PR-WALLET slice 3: mark the settlement method so the refund path
          // knows the tier base is a Stripe Payment (not a wallet debit).
          data: { status: 'CONFIRMED', paymentStatus: 'PAID', stripePaymentId: paymentIntent.id, paidWith: 'CARD', holdExpiresAt: null },
        });
      });

      await this.eventsService.emit(
        'BOOKING_CONFIRMED', 'CONSULTATION', consultationId, consult.leadId, 'SYSTEM', null,
        { paymentIntentId: paymentIntent.id },
      );
      this.logger.log(`Booking ${consultationId} confirmed on payment ${paymentIntent.id}`);
      // PR-BOOKING-5 — finalize: Jitsi link + confirmation email. Best-
      // effort + idempotent (meetingLink guard); never unwinds the paid
      // booking. Runs only on the genuine confirm path (not paid-no-slot).
      await this.bookingConfirmation.onConfirmed(consultationId).catch(() => undefined);
    } catch (e: any) {
      const slotLost = e?.__slotLost
        || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002');
      if (slotLost) {
        await this.prisma.consultation.update({
          where: { id: consultationId },
          data: {
            paymentStatus: 'PAID',
            stripePaymentId: paymentIntent.id,
            paidWith: 'CARD',
            scheduledAt: null,
            scheduledEndAt: null,
            holdExpiresAt: null,
          },
        });
        await this.eventsService.emit(
          'BOOKING_PAID_SLOT_LOST', 'CONSULTATION', consultationId, consult.leadId, 'SYSTEM', null,
          { paymentIntentId: paymentIntent.id },
        );
        this.logger.warn(
          `Booking ${consultationId} PAID but slot lost — flagged for refund/rebook (TODO: notify staff + client).`,
        );
        return;
      }
      throw e;
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
