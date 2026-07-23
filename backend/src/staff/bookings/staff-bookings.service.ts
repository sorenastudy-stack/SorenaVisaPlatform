import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConsultationType, LegalDecision, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RefundService } from '../../payments/refund.service';

// PR-WALLET slice 2 — staff bookings list backing /staff/bookings.
//
// Admins see every consultation booking; a consultant sees only the ones
// assigned to them. Window = last 30 days onward so a just-passed session is
// still markable as no-show. PENDING (unpaid holds) are excluded.

const ADMIN_TIER = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);
const LISTED_STATUSES = ['BOOKED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
const WALLET_REFUND_TYPES = ['REFUND_CANCEL_FULL', 'REFUND_CANCEL_LATE', 'REFUND_NO_SHOW'] as const;

@Injectable()
export class StaffBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refunds: RefundService,
  ) {}

  async list(actor: { userId: string; role: string }, now = new Date()) {
    const isAdmin = ADMIN_TIER.has(actor.role);
    const from = new Date(now.getTime() - 30 * 86_400_000);

    const rows = await this.prisma.consultation.findMany({
      where: {
        status: { in: [...LISTED_STATUSES] },
        scheduledAt: { gte: from },
        ...(isAdmin ? {} : { assignedToId: actor.userId }),
      },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true, type: true, status: true, paymentStatus: true, amountNZD: true,
        paidWith: true, stripePaymentId: true,
        scheduledAt: true, scheduledEndAt: true, durationMinutes: true,
        bookingTimezone: true, assignedToId: true, meetingLink: true,
        // PR-CONTRACT-GATE — the LIA verdict, so My Meetings can show/record it.
        decision: true,
        assignedTo: { select: { name: true } },
        lead: { select: { contact: { select: { fullName: true, user: { select: { name: true } } } } } },
      },
    });

    // PR-CARD-REFUND — a booking is card-refundable only for admins, only when
    // it was card-paid and still PAID (not already REFUNDED), and NOT already
    // store-credited to the wallet (that would double-pay). Resolve the
    // wallet-credited set in one query rather than per-row. The endpoint
    // re-checks all of this authoritatively; this just drives button display.
    const ids = rows.map((r) => r.id);
    const creditedIds = isAdmin && ids.length
      ? new Set(
          (await this.prisma.walletTransaction.findMany({
            where: { relatedConsultationId: { in: ids }, type: { in: [...WALLET_REFUND_TYPES] } },
            select: { relatedConsultationId: true },
          })).map((w) => w.relatedConsultationId),
        )
      : new Set<string | null>();

    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      decision: r.decision,
      paymentStatus: r.paymentStatus,
      amountNZD: r.amountNZD,
      scheduledAt: r.scheduledAt,
      scheduledEndAt: r.scheduledEndAt,
      durationMinutes: r.durationMinutes,
      timezone: r.bookingTimezone,
      // The Jitsi link for the "Join" button + the .ics on the staff My Meetings
      // page. Read-only passthrough — the link is generated at booking confirm.
      meetingLink: r.meetingLink,
      staffName: r.assignedTo?.name ?? null,
      clientName: r.lead?.contact?.fullName || r.lead?.contact?.user?.name || 'Client',
      // The UI enables No-show only once the session start has passed.
      startedOrPast: !!r.scheduledAt && r.scheduledAt.getTime() <= now.getTime(),
      // Admin-only: show the "Refund to card" action when it's a live card
      // payment that hasn't been wallet-credited.
      cardRefundable:
        isAdmin
        && r.paymentStatus === 'PAID'
        && r.paidWith === 'CARD'
        && !!r.stripePaymentId
        && !creditedIds.has(r.id),
    }));
  }

  // PR-CARD-REFUND — read-only preview for the owner-approval card. Resolves
  // the client, booking, and FULL captured amount (from the consultation's
  // Payment) that a refund would return, plus a "still refundable?" heads-up.
  // Display only — the authoritative amount/guards are re-derived at execution
  // inside RefundService.refundBookingToCard.
  async refundPreview(consultationId: string) {
    const c = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      select: {
        id: true, type: true, scheduledAt: true, bookingTimezone: true, currency: true,
        stripePaymentId: true,
        lead: { select: { contact: { select: { fullName: true, user: { select: { name: true } } } } } },
      },
    });
    if (!c) throw new NotFoundException('Booking not found');

    // Full captured amount comes from the Payment row (integer cents), not the
    // consultation's display amountNZD.
    let capturedCents: number | null = null;
    if (c.stripePaymentId) {
      const pay = await this.prisma.payment.findUnique({
        where: { stripePaymentIntentId: c.stripePaymentId }, select: { amount: true },
      });
      capturedCents = pay?.amount ?? null;
    }

    // Heads-up if state changed since the request (e.g. now wallet-credited /
    // already refunded). Never throws out of here — it's advisory display.
    let blocked: string | null = null;
    try { await this.refunds.assertRefundable(consultationId); }
    catch (e) { blocked = e instanceof Error ? e.message : 'This booking is no longer refundable.'; }

    return {
      consultationId: c.id,
      clientName: c.lead?.contact?.fullName || c.lead?.contact?.user?.name || 'Client',
      type: c.type,
      scheduledAt: c.scheduledAt,
      timezone: c.bookingTimezone,
      currency: c.currency,
      capturedCents,
      capturedAmountNZD: capturedCents != null ? capturedCents / 100 : null,
      blocked,
    };
  }

  // PR-CONTRACT-GATE (Phase A) — the LIA records their verdict on an LIA
  // consultation. This is the signal the contract-send gate reads for a
  // red-flagged (HS4) lead. Reuses the LegalDecision vocabulary.
  //
  // Authorization: the ASSIGNED LIA, or an admin. A consultant/client-officer
  // cannot record a legal verdict (the controller already keeps them off this
  // route; this is the defence-in-depth check). Recording a verdict implies the
  // session was held, so a non-terminal booking is flipped to COMPLETED here —
  // that keeps the gate's "COMPLETED + decision" precondition self-consistent.
  async recordLiaDecision(
    actor: { userId: string; role: string },
    consultationId: string,
    decision: LegalDecision,
    notes: string | undefined,
    now = new Date(),
  ) {
    const c = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      select: { id: true, type: true, status: true, assignedToId: true, leadId: true },
    });
    if (!c) throw new NotFoundException('Consultation not found');
    if (c.type !== ConsultationType.LIA) {
      throw new BadRequestException('A legal verdict can only be recorded on an LIA consultation.');
    }
    if (c.status === 'CANCELLED' || c.status === 'NO_SHOW') {
      throw new BadRequestException('Cannot record a verdict on a cancelled or no-show session.');
    }

    const isAdmin = ADMIN_TIER.has(actor.role);
    if (!isAdmin && c.assignedToId !== actor.userId) {
      throw new ForbiddenException('Only the assigned LIA (or an admin) can record this verdict.');
    }

    const trimmed = notes?.trim() || null;
    const updated = await this.prisma.consultation.update({
      where: { id: consultationId },
      data: {
        decision,
        decisionNotes: trimmed,
        decidedAt: now,
        decidedById: actor.userId,
        // Only touch status if it isn't already COMPLETED — never re-stamp it.
        ...(c.status === 'COMPLETED' ? {} : { status: 'COMPLETED', completedAt: now }),
      },
      select: { id: true, decision: true, decisionNotes: true, decidedAt: true, status: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actor.userId,
        action: 'LIA_CONSULTATION_DECISION',
        entityType: 'Consultation',
        entityId: consultationId,
        newValue: {
          leadId: c.leadId,
          decision,
          hasNotes: !!trimmed,
        } as Prisma.InputJsonValue,
      },
    });

    return updated;
  }
}
