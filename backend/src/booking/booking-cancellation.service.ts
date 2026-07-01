import {
  Injectable, Logger, ForbiddenException, NotFoundException,
  ConflictException, BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { computeRefund, hoursUntil, RefundKind } from './refund-policy';

// PR-WALLET slice 2 — cancellation / no-show → tiered store credit.
//
// Shared by the client self-cancel endpoints AND the staff marker. The credit
// posts to the CLIENT's wallet and the consultation status flips in ONE DB
// transaction; the slice-1 partial-unique index (one REFUND_* per consultation)
// is the race backstop — a concurrent double-credit hits P2002 and we surface
// a clean 409. FREE_15 has no money → status only. A paid booking with no
// linked Payment (data anomaly) flips status, posts NO credit, and is logged
// for manual review (never guesses an amount).

const ADMIN_TIER = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);
const CANCELLABLE = new Set(['CONFIRMED', 'BOOKED']);

type TerminalStatus = 'CANCELLED' | 'NO_SHOW';

interface LoadedConsultation {
  id: string;
  type: string;
  status: string;
  scheduledAt: Date | null;
  stripePaymentId: string | null;
  currency: string;
  assignedToId: string | null;
  clientUserId: string | null;
}

@Injectable()
export class BookingCancellationService {
  private readonly logger = new Logger(BookingCancellationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  // ── Client: preview (no mutation) ──────────────────────────────────────
  async previewClientCancel(userId: string, consultationId: string, now = new Date()) {
    const c = await this.load(consultationId);
    this.assertOwner(c, userId);
    const gate = this.clientCancelGate(c, now);
    if (!gate.ok) return { eligible: false as const, reason: gate.reason };

    if (c.type === 'FREE_15') {
      return { eligible: true as const, free: true, tier: 'free', creditCents: 0, retainedCents: 0, currency: c.currency };
    }
    const amount = await this.paymentAmountCents(c.stripePaymentId);
    if (amount == null) {
      return { eligible: true as const, free: false, tier: 'unknown', creditCents: 0, retainedCents: 0, currency: c.currency, note: 'no linked payment on file' };
    }
    const r = computeRefund(amount, 'CANCEL', hoursUntil(c.scheduledAt!, now));
    return {
      eligible: true as const, free: false, tier: r.type,
      creditCents: r.creditCents, retainedCents: r.retainedCents, currency: c.currency,
    };
  }

  // ── Client: self-cancel ────────────────────────────────────────────────
  async clientCancel(userId: string, consultationId: string, now = new Date()) {
    const c = await this.load(consultationId);
    this.assertOwner(c, userId);
    const gate = this.clientCancelGate(c, now);
    if (!gate.ok) {
      // Already terminal (cancelled/completed/no-show) is a conflict, not a
      // bad request — this is what keeps a repeat cancel idempotent (409).
      if (gate.code === 'terminal') throw new ConflictException(gate.reason);
      throw new BadRequestException(gate.reason);
    }
    return this.applyTerminal(c, { newStatus: 'CANCELLED', refundKind: 'CANCEL', now, actorId: userId });
  }

  // ── Staff: mark NO_SHOW / COMPLETED / CANCELLED ────────────────────────
  async staffMarkStatus(
    consultationId: string,
    actor: { userId: string; role: string },
    status: TerminalStatus | 'COMPLETED',
    now = new Date(),
  ) {
    const c = await this.load(consultationId);
    const isAdmin = ADMIN_TIER.has(actor.role);
    if (!isAdmin && c.assignedToId !== actor.userId) {
      throw new ForbiddenException('Only the assigned consultant or an admin can change this booking');
    }
    if (!CANCELLABLE.has(c.status)) {
      throw new ConflictException(`Booking is already ${c.status.toLowerCase()}`);
    }

    if (status === 'COMPLETED') {
      await this.prisma.consultation.update({
        where: { id: c.id }, data: { status: 'COMPLETED', completedAt: now },
      });
      return { status: 'COMPLETED' as const, credit: null, currency: c.currency };
    }

    if (status === 'NO_SHOW') {
      if (!c.scheduledAt || c.scheduledAt.getTime() > now.getTime()) {
        throw new BadRequestException('A no-show can only be marked after the session start time.');
      }
      return this.applyTerminal(c, { newStatus: 'NO_SHOW', refundKind: 'NO_SHOW', now, actorId: actor.userId });
    }

    // CANCELLED on the client's behalf — same time-based tier as a client cancel.
    return this.applyTerminal(c, { newStatus: 'CANCELLED', refundKind: 'CANCEL', now, actorId: actor.userId });
  }

  // ── internals ──────────────────────────────────────────────────────────
  private async load(consultationId: string): Promise<LoadedConsultation> {
    const c = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      select: {
        id: true, type: true, status: true, scheduledAt: true, stripePaymentId: true,
        currency: true, assignedToId: true,
        lead: { select: { contact: { select: { userId: true } } } },
      },
    });
    if (!c) throw new NotFoundException('Booking not found');
    return {
      id: c.id, type: c.type, status: c.status, scheduledAt: c.scheduledAt,
      stripePaymentId: c.stripePaymentId, currency: c.currency, assignedToId: c.assignedToId,
      clientUserId: c.lead?.contact?.userId ?? null,
    };
  }

  private assertOwner(c: LoadedConsultation, userId: string) {
    if (c.clientUserId !== userId) throw new ForbiddenException('This is not your booking');
  }

  private clientCancelGate(c: LoadedConsultation, now: Date): { ok: boolean; reason?: string; code?: 'terminal' | 'past' } {
    if (!CANCELLABLE.has(c.status)) {
      return { ok: false, code: 'terminal', reason: `This booking is already ${c.status.toLowerCase()}.` };
    }
    if (!c.scheduledAt || c.scheduledAt.getTime() <= now.getTime()) {
      return { ok: false, code: 'past', reason: 'This session has already started or passed — please contact support to cancel.' };
    }
    return { ok: true };
  }

  private async paymentAmountCents(stripePaymentId: string | null): Promise<number | null> {
    if (!stripePaymentId) return null;
    const pay = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: stripePaymentId }, select: { amount: true },
    });
    return pay?.amount ?? null;
  }

  /**
   * Atomically post the tiered credit (if a paid booking) and flip the status.
   * Reads (payment lookup) happen first; the write path re-checks the status
   * inside the transaction and relies on the unique index for the race.
   */
  private async applyTerminal(
    c: LoadedConsultation,
    opts: { newStatus: TerminalStatus; refundKind: RefundKind; now: Date; actorId: string },
  ) {
    const isFree = c.type === 'FREE_15';
    let paymentAmount: number | null = null;
    let paymentId: string | null = null;
    if (!isFree && c.stripePaymentId) {
      const pay = await this.prisma.payment.findUnique({
        where: { stripePaymentIntentId: c.stripePaymentId }, select: { id: true, amount: true },
      });
      if (pay) { paymentAmount = pay.amount; paymentId = pay.id; }
    }

    try {
      const credit = await this.prisma.$transaction(async (tx) => {
        // Guard concurrent transitions: only proceed from a cancellable state.
        const fresh = await tx.consultation.findUnique({ where: { id: c.id }, select: { status: true } });
        if (!fresh || !CANCELLABLE.has(fresh.status)) {
          throw new ConflictException(`Booking is already ${fresh?.status?.toLowerCase() ?? 'gone'}.`);
        }

        let posted: { type: string; creditCents: number; retainedCents: number } | null = null;
        if (!isFree && paymentAmount != null && c.clientUserId) {
          const r = computeRefund(paymentAmount, opts.refundKind, c.scheduledAt ? hoursUntil(c.scheduledAt, opts.now) : 0);
          if (r.creditCents > 0) {
            await this.wallet.postTransaction({
              userId: c.clientUserId,
              amountCents: r.creditCents,
              type: r.type,
              createdById: opts.actorId,
              reason: `${c.type} booking — ${r.tierLabel}`,
              relatedConsultationId: c.id,
              relatedPaymentId: paymentId ?? undefined,
            }, tx);
          }
          posted = { type: r.type, creditCents: r.creditCents, retainedCents: r.retainedCents };
        }

        await tx.consultation.update({ where: { id: c.id }, data: { status: opts.newStatus } });
        return posted;
      });

      if (!isFree && paymentAmount == null) {
        this.logger.warn(
          `Booking ${c.id} (${c.type}) marked ${opts.newStatus} but has NO linked Payment — ` +
          `status changed, NO wallet credit posted. Flag for manual review.`,
        );
      }
      return { status: opts.newStatus, credit, currency: c.currency };
    } catch (e) {
      // Race backstop: the unique index rejected a second REFUND_* for this
      // consultation → it was already cancelled/credited.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This booking has already been cancelled.');
      }
      throw e;
    }
  }
}
