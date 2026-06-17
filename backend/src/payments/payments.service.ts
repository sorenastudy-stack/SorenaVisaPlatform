import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { StripeService } from './stripe.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecordManualPaymentDto } from './dto/record-manual-payment.dto';

const CONSULTATION_AMOUNTS: Record<string, number> = {
  GAP_CLOSING: 30,
  ADMISSION_CONSULTATION: 50,
  LIA_CONSULTATION: 150,
  ACCOUNT_OPENING: 200,
  FREE_SESSION: 0,
};

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
    amount?: number,
    currency: string = 'nzd',
    // PR-LIA-AUTO-ASSIGN — optional caseId, plumbed through to the Stripe
    // link's metadata so the post-payment webhook can auto-assign an LIA
    // to that case. Callers that don't have a case (regular consultation
    // bookings) omit this and the chain behaves as before.
    caseId?: string,
  ) {
    const amountNZD = amount ?? CONSULTATION_AMOUNTS[consultationType];
    if (amountNZD === undefined) {
      throw new BadRequestException(`Unknown consultation type: ${consultationType}`);
    }
    if (amountNZD === 0) {
      return { url: null, free: true, consultationType };
    }
    const paymentLink = await this.stripeService.createConsultationPaymentLink(
      leadId,
      consultationType,
      amountNZD,
      currency,
      caseId,
    );
    return { url: paymentLink.url, free: false, consultationType };
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
        id:          true,
        amount:      true,
        currency:    true,
        status:      true,
        paymentType: true,
        createdAt:   true,
      },
    });
    return rows.map((r) => ({
      id:          r.id,
      amount:      r.amount,
      currency:    r.currency,
      status:      r.status,
      paymentType: r.paymentType,
      createdAt:   r.createdAt,
      isManual:    r.paymentType === 'manual',
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

    const stripePaymentIntentId = `manual_${randomUUID()}`;
    const currency = (dto.currency ?? 'nzd').toLowerCase();

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
          amount:      dto.amount,
          currency,
          status:      'succeeded',
          metadata:    metadata as Prisma.InputJsonValue,
        },
        select: {
          id:          true,
          amount:      true,
          currency:    true,
          status:      true,
          paymentType: true,
          createdAt:   true,
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
            leadId:      c.leadId,
            paymentType: 'manual',
            amount:      dto.amount,
            currency,
            hasNote:     !!dto.note,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name,
          actorRoleSnapshot: actor.role,
        },
      });

      return payment;
    });

    return {
      id:          created.id,
      amount:      created.amount,
      currency:    created.currency,
      status:      created.status,
      paymentType: created.paymentType,
      createdAt:   created.createdAt,
      isManual:    true,
    };
  }
}
