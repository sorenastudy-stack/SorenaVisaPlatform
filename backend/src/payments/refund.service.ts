import {
  Injectable, Logger, NotFoundException, BadRequestException,
  ConflictException, HttpException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';

// PR-CARD-REFUND — real Stripe card refunds for the exceptional cash-out
// cases (legal / service-not-provided). Highest-stakes path: moves real money
// OUT of the Stripe account. FULL refund of the original card payment only.
//
// Two-person control: this service is NOT called from an admin-facing endpoint
// directly. An admin REQUESTS a refund (owner-approval ISSUE_REFUND), and only
// the OWNER's approval executes `refundBookingToCard`. `assertRefundable` is the
// read-only pre-check used at REQUEST time; the same guards re-run here at
// APPROVAL time so nothing that changed in between can cause a double-pay or
// over-refund.
//
// Money-integrity invariant: total returned to a client (wallet credit + card
// cash) must never exceed the captured amount. The two refund paths are kept
// mutually exclusive — if a booking was already store-credited on cancel/
// no-show, a card refund is REFUSED (the client would be paid twice).

const WALLET_REFUND_TYPES = ['REFUND_CANCEL_FULL', 'REFUND_CANCEL_LATE', 'REFUND_NO_SHOW'] as const;

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  /**
   * Read-only guards → the captured payment to refund. Throws if the booking
   * isn't card-refundable. Shared by the request-time pre-check
   * (`assertRefundable`) and the approval-time execution (`refundBookingToCard`)
   * so both enforce the identical rules.
   */
  private async loadRefundable(consultationId: string): Promise<{
    paymentId: string; amountCents: number; paymentIntentId: string;
  }> {
    // 1. Booking + how it was paid.
    const c = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      select: { id: true, paidWith: true, paymentStatus: true, stripePaymentId: true },
    });
    if (!c) throw new NotFoundException('Booking not found');
    if (c.paidWith === 'WALLET') {
      throw new BadRequestException('This booking was paid with wallet credit — it cannot be refunded to a card.');
    }
    if (!c.stripePaymentId) {
      throw new BadRequestException('This booking has no card payment to refund.');
    }

    // 2. Wallet-exclusivity: refuse if already store-credited (else double-pay).
    const walletCredit = await this.prisma.walletTransaction.findFirst({
      where: { relatedConsultationId: consultationId, type: { in: [...WALLET_REFUND_TYPES] } },
      select: { id: true },
    });
    if (walletCredit) {
      throw new ConflictException(
        'This booking was already refunded to the client\'s wallet — a card refund would pay them twice.',
      );
    }

    // 3. The original captured payment (integer cents, real PaymentIntent).
    const payment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: c.stripePaymentId },
      select: { id: true, amount: true, stripePaymentIntentId: true },
    });
    if (!payment) throw new BadRequestException('No payment record found for this booking.');
    if (payment.amount <= 0) throw new BadRequestException('Captured amount is zero — nothing to refund.');

    // 4. Idempotency pre-check: no live (PENDING/COMPLETED) refund already exists.
    const existing = await this.prisma.refund.findFirst({
      where: { paymentId: payment.id, status: { in: ['PENDING', 'COMPLETED'] } },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A refund for this payment already exists.');

    return { paymentId: payment.id, amountCents: payment.amount, paymentIntentId: payment.stripePaymentIntentId };
  }

  /**
   * Request-time pre-check (no money moves) — lets an admin see immediately
   * whether a booking is card-refundable before enqueuing an approval request.
   */
  async assertRefundable(consultationId: string): Promise<void> {
    await this.loadRefundable(consultationId);
  }

  /**
   * APPROVAL-time execution. Called ONLY from the owner-approval ISSUE_REFUND
   * executor (`actorId` is the approving OWNER). Re-runs every guard, then
   * issues a full refund of the captured amount. Idempotent: the DB
   * "one live refund per payment" index + a Stripe idempotency key keyed on the
   * payment make a double-approve resolve to a single refund.
   */
  async refundBookingToCard(consultationId: string, actorId: string, reason?: string) {
    // Re-run the guards NOW (state may have changed since the request).
    const { paymentId, amountCents, paymentIntentId } = await this.loadRefundable(consultationId);

    // Record intent (PENDING). The partial-unique index is the race backstop.
    let refundId: string;
    try {
      const row = await this.prisma.refund.create({
        data: {
          paymentId,
          consultationId,
          amountCents, // FULL refund of the captured amount
          reason: reason ?? null,
          status: 'PENDING',
          createdById: actorId,
        },
        select: { id: true },
      });
      refundId = row.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A refund for this payment is already in progress.');
      }
      throw e;
    }

    // Real Stripe refund. Idempotency key is keyed on the PAYMENT so a
    // retry/double-approve can never issue a second refund for the same charge.
    try {
      const sr = await this.stripe.createRefund({
        paymentIntentId,
        amountCents,
        reason,
        idempotencyKey: `refund_${paymentId}`,
      });
      const mapped = sr.status === 'succeeded' ? 'COMPLETED'
        : sr.status === 'pending' ? 'PENDING'
        : 'FAILED';

      try {
        await this.prisma.$transaction([
          this.prisma.refund.update({ where: { id: refundId }, data: { status: mapped, stripeRefundId: sr.id } }),
          ...(mapped !== 'FAILED'
            ? [this.prisma.consultation.update({ where: { id: consultationId }, data: { paymentStatus: 'REFUNDED' } })]
            : []),
        ]);
      } catch (dbErr) {
        // A concurrent approval already recorded this (same idempotent Stripe
        // refund). Drop our placeholder and surface a clean conflict — no
        // second refund happened (idempotency key collapsed them).
        if (dbErr instanceof Prisma.PrismaClientKnownRequestError && dbErr.code === 'P2002') {
          await this.prisma.refund.delete({ where: { id: refundId } }).catch(() => undefined);
          throw new ConflictException('A refund for this payment already exists.');
        }
        throw dbErr;
      }

      if (mapped === 'FAILED') {
        this.logger.error(`Card refund ${sr.id} for consultation ${consultationId} returned status=${sr.status}`);
        throw new BadRequestException(`Stripe refund did not succeed (status: ${sr.status}).`);
      }
      this.logger.log(`Card refund ${sr.id} (${amountCents}c) for consultation ${consultationId} approved by ${actorId} → ${mapped}`);
      return { status: mapped, refundId, stripeRefundId: sr.id, amountCents };
    } catch (e) {
      if (e instanceof ConflictException) throw e; // dup collapse above — leave as-is
      // Stripe (or mapping) failed → mark the row FAILED so it doesn't hold the
      // "one live refund" slot and the payment isn't locked. FAILED is excluded
      // from the partial-unique index, so a corrected retry can proceed.
      const msg = e instanceof Error ? e.message : String(e);
      await this.prisma.refund
        .update({ where: { id: refundId }, data: { status: 'FAILED', reason: `${reason ?? ''} | stripe_error: ${msg}`.slice(0, 500) } })
        .catch(() => undefined);
      if (e instanceof HttpException) throw e; // preserve the mapped FAILED 400
      this.logger.error(`Card refund FAILED for consultation ${consultationId}: ${msg}`);
      throw new BadRequestException(`Refund failed: ${msg}`);
    }
  }
}
