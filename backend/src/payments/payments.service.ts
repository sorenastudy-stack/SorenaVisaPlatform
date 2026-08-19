import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { StripeService } from './stripe.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecordManualPaymentDto } from './dto/record-manual-payment.dto';
import { FEE_CURRENCY, GST_RATE, calculateFeeBreakdown, getFeePriceCents, isFeeType } from './fee-config';
import { readPayerFromMetadata, type ThirdPartyPayer } from './third-party-payer';

// PR-PHASE40 — this table used to live here with its own numbers (GAP_CLOSING
// 30, LIA_CONSULTATION 150, both NZD) while booking priced the same two
// sessions at USD 20 and USD 58. Same session, different money, depending on
// whether the client booked a slot or was sent a payment link.
//
// Prices now come from fee-config, which re-exports the booking config for the
// bookable types, so the two cannot diverge again. FREE_SESSION is kept as an
// alias for FREE_15 because sales-side callers still send that string.
function consultationAmountCents(consultationType: string): number | undefined {
  if (consultationType === 'FREE_SESSION') return 0;
  if (!isFeeType(consultationType)) return undefined;
  return getFeePriceCents(consultationType);
}

export interface PaymentActor {
  id:   string;
  name: string | null;
  role: string | null;
}

@Injectable()
export class PaymentsService {
  constructor(
    private stripeService: StripeService,
    private prisma: PrismaService,
  ) {}

  async createConsultationPaymentLink(
    leadId: string,
    consultationType: string,
    /** Override in WHOLE UNITS (dollars), as callers have always passed it. */
    amount?: number,
    currency: string = FEE_CURRENCY,
    // PR-LIA-AUTO-ASSIGN — optional caseId, plumbed through to the Stripe
    // link's metadata so the post-payment webhook can auto-assign an LIA
    // to that case. Callers that don't have a case (regular consultation
    // bookings) omit this and the chain behaves as before.
    caseId?: string,
    // PR-CHECKLIST item 11 — a declared third-party payer, when the person
    // settling this link is not the client.
    payer?: ThirdPartyPayer,
  ) {
    const baseCents = amount !== undefined
      ? Math.round(amount * 100)
      : consultationAmountCents(consultationType);
    if (baseCents === undefined) {
      throw new BadRequestException(`Unknown consultation type: ${consultationType}`);
    }
    if (baseCents === 0) {
      return { url: null, free: true, consultationType };
    }

    // PR-PHASE40 — a payment link is a CARD payment, so the client pays base +
    // GST + Stripe's fee. The breakdown is computed here and passed down whole:
    // Stripe renders it as separate line items, so the client sees the tax and
    // the processing fee rather than one opaque number.
    const breakdown = calculateFeeBreakdown(baseCents, 'card', currency);

    const paymentLink = await this.stripeService.createConsultationPaymentLink(
      leadId,
      consultationType,
      breakdown,
      caseId,
      payer,
    );
    return { url: paymentLink.url, free: false, consultationType, breakdown };
  }

  // ─── Case-keyed convenience: resolve leadId from caseId, then delegate ──
  //
  // The staff Payments tab on the case detail page already has caseId in
  // scope but NOT leadId (the /api/staff/cases/:id response intentionally
  // doesn't surface internal FKs). Rather than thread leadId through the
  // frontend or extend the case-detail DTO, this method resolves leadId
  // server-side and forwards to the existing createConsultationPaymentLink
  // chain — same Stripe link metadata, same response shape.
  //
  // Passing caseId as the 5th arg matches how ACCOUNT_OPENING links are
  // created today: the post-payment webhook reads `metadata.caseId` and
  // can tie the resulting Payment row directly to the case (instead of
  // only through the lead).
  async createConsultationLinkForCase(
    caseId: string,
    consultationType: string,
    // PR-CHECKLIST item 11 — set when someone other than the client is paying.
    payer?: ThirdPartyPayer,
  ) {
    const c = await this.prisma.case.findUnique({
      where:  { id: caseId },
      select: { leadId: true },
    });
    if (!c) {
      throw new NotFoundException('Case not found');
    }
    return this.createConsultationPaymentLink(
      c.leadId,
      consultationType,
      undefined,   // amount — fall back to the fee-config price for this type
      FEE_CURRENCY,
      caseId,      // 5th arg threads caseId into the Stripe link metadata
      payer,
    );
  }

  // ─── Case-keyed custom-amount payment link ─────────────────────────────
  //
  // Parallel sibling of createConsultationLinkForCase, for when staff need
  // to invoice an arbitrary amount that isn't one of the fixed
  // consultation prices. Resolves leadId from caseId, then delegates to
  // StripeService.createCustomAmountPaymentLink which uses inline
  // line_items[].price_data instead of stripe.prices.create.
  //
  // The metadata propagation (top-level + payment_intent_data) is handled
  // identically to the consultation path so the webhook records the
  // resulting Payment row against this caseId.
  async createCustomLinkForCase(
    caseId:      string,
    amountCents: number,
    currency:    string = FEE_CURRENCY,
    invoiceId?:  string,
    // PR-CHECKLIST item 11 — set when someone other than the client is paying.
    payer?:      ThirdPartyPayer,
  ) {
    const c = await this.prisma.case.findUnique({
      where:  { id: caseId },
      select: { leadId: true },
    });
    if (!c) {
      throw new NotFoundException('Case not found');
    }

    const paymentLink = await this.stripeService.createCustomAmountPaymentLink(
      c.leadId,
      caseId,
      amountCents,
      currency,
      invoiceId,
      payer,
    );

    return {
      url:      paymentLink.url,
      amount:   amountCents,
      currency,
    };
  }

  // ─── List payments for a case ────────────────────────────────────────
  //
  // Payment.caseId is nullable: only ACCOUNT_OPENING charges set it
  // directly. Consultation and subscription payments carry caseId=NULL
  // and link to the case only indirectly through the lead. So a true
  // "payments on this case" view must OR the two paths:
  //
  //   • Payment.caseId = caseId                 (direct, ACCOUNT_OPENING + manual)
  //   • Payment.lead.cases includes caseId       (indirect, consultation + subscription)
  //
  // Single query; whitelisted projection (no Stripe metadata, no raw
  // intent id) suitable for the staff Payments tab.
  async listPaymentsForCase(caseId: string) {
    const rows = await this.prisma.payment.findMany({
      where: {
        OR: [
          { caseId },
          { lead: { cases: { some: { id: caseId } } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id:                 true,
        amount:             true,
        currency:           true,
        status:             true,
        paymentType:        true,
        createdAt:          true,
        // Phase 6.5 — finance verification fields.
        verificationStatus: true,
        verifiedById:       true,
        verifiedAt:         true,
        verificationNote:   true,
        receiptDocumentId:  true,
        // PR-CHECKLIST item 11 — carries the declared third-party payer.
        metadata:           true,
      },
    });

    // Phase 6.5 — batched name resolution for verifiedById.
    //
    // We chose plain-String/no-relation for verifiedById (CrmEvent.actorId
    // convention — see schema comment), so Prisma can't `include` the
    // verifying user. Instead: collect the distinct verifier ids in this
    // result set and do ONE findMany to fetch their display names. This
    // adds at most a single tiny query per case load, and only when at
    // least one row has actually been verified. The frontend gets
    // `verifiedByName` ready to render — no second round-trip.
    const verifierIds = Array.from(
      new Set(rows.map((r) => r.verifiedById).filter((v): v is string => !!v)),
    );
    const verifiers = verifierIds.length
      ? await this.prisma.user.findMany({
          where:  { id: { in: verifierIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(verifiers.map((u) => [u.id, u.name]));

    return rows.map((r) => ({
      id:                 r.id,
      amount:             r.amount,
      currency:           r.currency,
      status:             r.status,
      paymentType:        r.paymentType,
      createdAt:          r.createdAt,
      isManual:           r.paymentType === 'manual',
      verificationStatus: r.verificationStatus,
      verifiedById:       r.verifiedById,
      verifiedByName:     r.verifiedById ? nameById.get(r.verifiedById) ?? null : null,
      verifiedAt:         r.verifiedAt,
      verificationNote:   r.verificationNote,
      receiptDocumentId:  r.receiptDocumentId,
      // PR-CHECKLIST item 11 — null when the client paid for themselves, which
      // is every payment recorded before this existed. Surfaced here rather
      // than left in the metadata blob because a compliance record nobody can
      // read is not a compliance record.
      thirdPartyPayer:    readPayerFromMetadata(r.metadata),
    }));
  }

  // ─── Manual mark-as-paid ─────────────────────────────────────────────
  //
  // Staff entered a non-Stripe payment (cash, wire, cheque). We persist
  // it as a regular Payment row so every read path that already knows
  // about Payment (lists, totals, audit, downstream LIA-assignment
  // triggers if anyone keys off paymentType) treats it uniformly.
  //
  // The synthetic stripePaymentIntentId is prefixed `manual_` followed
  // by a UUID — guaranteed not to collide with real Stripe ids (which
  // start `pi_` and are short alphanumeric strings) so the existing
  // P2002-idempotency path on the webhook is not affected.
  //
  // Atomic: Payment + audit row are written in one $transaction. If
  // either fails neither persists.
  async recordManualPayment(
    caseId: string,
    dto: RecordManualPaymentDto,
    actor: PaymentActor,
  ) {
    const c = await this.prisma.case.findUnique({
      where:  { id: caseId },
      select: { id: true, leadId: true },
    });
    if (!c) {
      throw new NotFoundException('Case not found');
    }

    // Phase 6.5 — receipt is required. Validate the document exists,
    // belongs to THIS case (prevents a caller from attaching another
    // case's document), and has actually been uploaded (status UPLOADED
    // — not PENDING/FAILED, which represent half-finished upload state).
    const receipt = await this.prisma.document.findUnique({
      where:  { id: dto.receiptDocumentId },
      select: { id: true, caseId: true, status: true },
    });
    if (!receipt) {
      throw new NotFoundException('Receipt document not found');
    }
    if (receipt.caseId !== caseId) {
      throw new BadRequestException(
        'Receipt document does not belong to this case',
      );
    }
    if (receipt.status !== 'UPLOADED') {
      throw new BadRequestException(
        'Receipt upload is not complete — please re-upload before recording the payment',
      );
    }

    const stripePaymentIntentId = `manual_${randomUUID()}`;
    const currency = (dto.currency ?? FEE_CURRENCY).toLowerCase();

    // PR-PHASE40 — GST on the manual (bank transfer) path.
    //
    // `dto.amount` is the BASE price, the same thing every other pathway starts
    // from, and GST is ADDED on top. All three pathways therefore compute tax
    // identically — base → +GST → total — and the only difference is the card
    // fee, which is absent here because a bank transfer never touches Stripe.
    //
    // Deliberately not the reverse (base = total ÷ 1.15). Extracting tax from
    // whatever figure landed in the account makes the GST a function of the
    // amount transferred, so a client who rounded their payment would change
    // the tax recorded against the invoice.
    const breakdown = calculateFeeBreakdown(dto.amount, 'bank', currency);

    const metadata: Record<string, unknown> = {
      manual:    true,
      actorId:   actor.id,
      actorName: actor.name,
      actorRole: actor.role,
    };
    if (dto.note) metadata.note = dto.note;

    const created = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          stripePaymentIntentId,
          leadId:      c.leadId,
          caseId:      c.id,
          paymentType: 'manual',
          // The TOTAL that moved, matching what the Stripe path records
          // (`paymentIntent.amount_received`, likewise GST-inclusive).
          // `gstCents` carries the tax component so the parts stay recoverable
          // without anyone re-deriving them.
          amount:      breakdown.totalCents,
          currency,
          gstCents:     breakdown.gstCents,
          cardFeeCents: breakdown.cardFeeCents,   // 0 — no card was processed
          status:      'succeeded',
          metadata:    metadata as Prisma.InputJsonValue,
          // Phase 6.5 — finance verification.
          // PENDING is the column default; set explicitly so the intent
          // is unambiguous on this critical money path. receiptDocumentId
          // is validated above to belong to this case.
          verificationStatus: 'PENDING',
          receiptDocumentId:  receipt.id,
        },
        select: {
          id:                 true,
          amount:             true,
          currency:           true,
          status:             true,
          paymentType:        true,
          createdAt:          true,
          verificationStatus: true,
          receiptDocumentId:  true,
        },
      });

      // Audit (Security Layer 6). Mirrors the direct-prisma.auditLog.create
      // pattern used by lia-assignment, documents, case-documents, and the
      // rest of the codebase — there is no central audit-write helper.
      await tx.auditLog.create({
        data: {
          userId:     actor.id,
          action:     'CREATE',
          eventType:  'PAYMENT_RECORDED_MANUAL',
          entityType: 'PAYMENT',
          entityId:   payment.id,
          newValue: {
            caseId,
            leadId:             c.leadId,
            paymentType:        'manual',
            amount:             dto.amount,
            currency,
            hasNote:            !!dto.note,
            receiptDocumentId:  receipt.id,
            verificationStatus: 'PENDING',
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name,
          actorRoleSnapshot: actor.role,
        },
      });

      return payment;
    });

    return {
      id:                 created.id,
      amount:             created.amount,
      currency:           created.currency,
      status:             created.status,
      paymentType:        created.paymentType,
      createdAt:          created.createdAt,
      isManual:           true,
      verificationStatus: created.verificationStatus,
      receiptDocumentId:  created.receiptDocumentId,
    };
  }

  // ─── Finance verification: confirm + reject ──────────────────────────
  //
  // Both transitions are PENDING → CONFIRMED or PENDING → REJECTED. We
  // refuse to re-verify an already-finalised row (409 Conflict) — a
  // double-confirm or a confirm-after-reject is a workflow bug, not a
  // legitimate operation. Audit row written in the same $transaction as
  // the update.

  async confirmPayment(
    paymentId: string,
    actor: PaymentActor,
    note?: string,
  ) {
    return this.transitionVerification(
      paymentId,
      'CONFIRMED',
      actor,
      note?.trim() || null,
    );
  }

  async rejectPayment(
    paymentId: string,
    actor: PaymentActor,
    note: string,
  ) {
    const trimmed = (note ?? '').trim();
    if (!trimmed) {
      // Defence-in-depth — DTO already requires this, but a
      // service-level guard means rejectPayment can't ever land a
      // reason-less rejection (the audit story stays clean even if a
      // future caller bypasses the DTO).
      throw new BadRequestException('A rejection reason is required.');
    }
    return this.transitionVerification(paymentId, 'REJECTED', actor, trimmed);
  }

  private async transitionVerification(
    paymentId: string,
    next: 'CONFIRMED' | 'REJECTED',
    actor: PaymentActor,
    note: string | null,
  ) {
    const existing = await this.prisma.payment.findUnique({
      where:  { id: paymentId },
      select: { id: true, caseId: true, verificationStatus: true },
    });
    if (!existing) {
      throw new NotFoundException('Payment not found');
    }
    if (existing.verificationStatus !== 'PENDING') {
      throw new ConflictException(
        `Payment is already ${existing.verificationStatus.toLowerCase()} — cannot re-verify`,
      );
    }

    const verifiedAt = new Date();
    const eventType =
      next === 'CONFIRMED'
        ? 'PAYMENT_VERIFICATION_CONFIRMED'
        : 'PAYMENT_VERIFICATION_REJECTED';

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.payment.update({
        where: { id: paymentId },
        data: {
          verificationStatus: next,
          verifiedById:       actor.id,
          verifiedAt,
          verificationNote:   note,
        },
        select: {
          id:                 true,
          verificationStatus: true,
          verifiedById:       true,
          verifiedAt:         true,
          verificationNote:   true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId:     actor.id,
          action:     'UPDATE',
          eventType,
          entityType: 'PAYMENT',
          entityId:   paymentId,
          newValue: {
            paymentId,
            caseId:         existing.caseId,
            previousStatus: 'PENDING',
            newStatus:      next,
            hasNote:        !!note,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name,
          actorRoleSnapshot: actor.role,
        },
      });

      return row;
    });
  }
}
