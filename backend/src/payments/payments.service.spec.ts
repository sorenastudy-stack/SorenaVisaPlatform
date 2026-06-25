/**
 * Phase 6 + 6.5 — unit tests for PaymentsService.
 *
 * Pattern matches the other service specs (auth, portal, documents):
 * hand-rolled prisma + stripe mocks, direct construction, no Nest boot.
 *
 * Covers:
 *   • listPaymentsForCase (whitelisted shape, OR query, name resolution)
 *   • recordManualPayment (atomic write + audit + receipt validation)
 *   • createConsultationLinkForCase (caseId → leadId delegation)
 *   • confirmPayment / rejectPayment (transition + audit + already-verified guard)
 */

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';

// ─── Helpers ────────────────────────────────────────────────────────────

function makeService(opts: {
  payments?:        Array<Record<string, unknown>>;
  caseRow?:         { id: string; leadId: string } | null;
  documentRow?:    { id: string; caseId: string; status: string } | null;
  paymentRow?:     { id: string; caseId: string | null; verificationStatus: string } | null;
  paymentCreate?:  jest.Mock;
  paymentUpdate?:  jest.Mock;
  auditCreate?:    jest.Mock;
  users?:          Array<{ id: string; name: string }>;
}) {
  const findMany       = jest.fn().mockResolvedValue(opts.payments ?? []);
  const caseFindUnique = jest.fn().mockResolvedValue(opts.caseRow ?? null);
  const docFindUnique  = jest.fn().mockResolvedValue(opts.documentRow ?? null);
  const payFindUnique  = jest.fn().mockResolvedValue(opts.paymentRow ?? null);
  const userFindMany   = jest.fn().mockResolvedValue(opts.users ?? []);

  const paymentCreate = opts.paymentCreate ?? jest.fn(async ({ data }: any) => ({
    id:                 'pay-new',
    amount:             data.amount,
    currency:           data.currency,
    status:             data.status,
    paymentType:        data.paymentType,
    createdAt:          new Date('2026-06-18T00:00:00Z'),
    verificationStatus: data.verificationStatus ?? 'PENDING',
    receiptDocumentId:  data.receiptDocumentId ?? null,
  }));

  const paymentUpdate = opts.paymentUpdate ?? jest.fn(async ({ data }: any) => ({
    id:                 'pay-existing',
    verificationStatus: data.verificationStatus,
    verifiedById:       data.verifiedById,
    verifiedAt:         data.verifiedAt,
    verificationNote:   data.verificationNote,
  }));

  const auditCreate = opts.auditCreate ?? jest.fn().mockResolvedValue({ id: 'audit-1' });

  const prismaMock: any = {
    payment: {
      findMany,
      findUnique: payFindUnique,
      create:     paymentCreate,
      update:     paymentUpdate,
    },
    case:     { findUnique: caseFindUnique },
    document: { findUnique: docFindUnique },
    user:     { findMany:   userFindMany },
    auditLog: { create:     auditCreate },
    $transaction: jest.fn(async (cb: any) => cb({
      payment:  { create: paymentCreate, update: paymentUpdate },
      auditLog: { create: auditCreate },
    })),
  };

  const stripeMock: any = {
    createConsultationPaymentLink: jest.fn(),
  };

  const service = new PaymentsService(stripeMock, prismaMock);
  return {
    service, prisma: prismaMock, stripe: stripeMock,
    findMany, caseFindUnique, docFindUnique, payFindUnique, userFindMany,
    paymentCreate, paymentUpdate, auditCreate,
  };
}

const ACTOR = { id: 'staff-1', name: 'Staff One', role: 'FINANCE' as string | null };
const VALID_RECEIPT = { id: 'doc-receipt-1', caseId: 'case-1', status: 'UPLOADED' };

// ─── listPaymentsForCase ────────────────────────────────────────────────

describe('PaymentsService.listPaymentsForCase', () => {
  it('returns whitelisted shape including verification fields + isManual flag', async () => {
    const directPayment = {
      id: 'pay-direct', amount: 20000, currency: 'nzd', status: 'succeeded',
      paymentType: 'ACCOUNT_OPENING',
      createdAt: new Date('2026-06-15T10:00:00Z'),
      verificationStatus: 'CONFIRMED',
      verifiedById:       'staff-finance-1',
      verifiedAt:         new Date('2026-06-15T11:00:00Z'),
      verificationNote:   'Stripe receipt looks good',
      receiptDocumentId:  null,
    };
    const indirectPayment = {
      id: 'pay-indirect', amount: 5000, currency: 'nzd', status: 'succeeded',
      paymentType: 'consultation',
      createdAt: new Date('2026-06-10T10:00:00Z'),
      verificationStatus: 'PENDING',
      verifiedById:       null,
      verifiedAt:         null,
      verificationNote:   null,
      receiptDocumentId:  null,
    };
    const manualPayment = {
      id: 'pay-manual', amount: 30000, currency: 'nzd', status: 'succeeded',
      paymentType: 'manual',
      createdAt: new Date('2026-06-17T10:00:00Z'),
      verificationStatus: 'PENDING',
      verifiedById:       null,
      verifiedAt:         null,
      verificationNote:   null,
      receiptDocumentId:  'doc-receipt-1',
    };
    const { service, findMany, userFindMany } = makeService({
      payments: [manualPayment, directPayment, indirectPayment],
      users:    [{ id: 'staff-finance-1', name: 'Mira Finance' }],
    });

    const rows = await service.listPaymentsForCase('case-1');

    expect(rows).toHaveLength(3);

    // Manual row — PENDING, has receipt, no verifier yet.
    expect(rows[0]).toEqual({
      id: 'pay-manual', amount: 30000, currency: 'nzd', status: 'succeeded',
      paymentType: 'manual',
      createdAt: new Date('2026-06-17T10:00:00Z'),
      isManual:           true,
      verificationStatus: 'PENDING',
      verifiedById:       null,
      verifiedByName:     null,
      verifiedAt:         null,
      verificationNote:   null,
      receiptDocumentId:  'doc-receipt-1',
    });

    // Stripe ACCOUNT_OPENING row — CONFIRMED with verifier name resolved.
    expect(rows[1].paymentType).toBe('ACCOUNT_OPENING');
    expect(rows[1].isManual).toBe(false);
    expect(rows[1].verificationStatus).toBe('CONFIRMED');
    expect(rows[1].verifiedById).toBe('staff-finance-1');
    expect(rows[1].verifiedByName).toBe('Mira Finance');     // batched lookup hit
    expect(rows[1].verificationNote).toBe('Stripe receipt looks good');

    // Consultation row — PENDING, no verifier, no receipt.
    expect(rows[2].paymentType).toBe('consultation');
    expect(rows[2].isManual).toBe(false);
    expect(rows[2].verificationStatus).toBe('PENDING');
    expect(rows[2].verifiedByName).toBe(null);

    // Each row excludes leakable bits.
    for (const r of rows) {
      expect(r).not.toHaveProperty('metadata');
      expect(r).not.toHaveProperty('stripePaymentIntentId');
      expect(r).not.toHaveProperty('leadId');
      expect(r).not.toHaveProperty('caseId');
    }

    // OR query intact.
    const where = findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      OR: [
        { caseId: 'case-1' },
        { lead: { cases: { some: { id: 'case-1' } } } },
      ],
    });
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });

    // Name-resolution lookup was batched to the distinct verifier id set.
    expect(userFindMany).toHaveBeenCalledTimes(1);
    expect(userFindMany.mock.calls[0][0]).toEqual({
      where:  { id: { in: ['staff-finance-1'] } },
      select: { id: true, name: true },
    });
  });

  it('skips the user.findMany lookup entirely when no row has a verifier', async () => {
    const pending = {
      id: 'pay-1', amount: 1, currency: 'nzd', status: 'succeeded',
      paymentType: 'consultation',
      createdAt: new Date('2026-06-10T10:00:00Z'),
      verificationStatus: 'PENDING',
      verifiedById:       null,
      verifiedAt:         null,
      verificationNote:   null,
      receiptDocumentId:  null,
    };
    const { service, userFindMany } = makeService({ payments: [pending] });

    await service.listPaymentsForCase('case-empty-verifiers');

    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('returns [] when there are no payments for the case', async () => {
    const { service } = makeService({ payments: [] });
    const rows = await service.listPaymentsForCase('case-empty');
    expect(rows).toEqual([]);
  });

  it('the OR query excludes payments from other cases/leads (the prisma WHERE is what enforces it)', async () => {
    const { service, findMany } = makeService({ payments: [] });
    await service.listPaymentsForCase('case-restricted');

    const where = findMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0]).toHaveProperty('caseId', 'case-restricted');
    expect(where.OR[1].lead.cases.some.id).toBe('case-restricted');
  });
});

// ─── recordManualPayment ────────────────────────────────────────────────

describe('PaymentsService.recordManualPayment', () => {
  it('resolves leadId from caseId and writes a Payment row with correct manual fields + receipt + PENDING verification', async () => {
    let capturedPaymentArgs: any = null;
    const paymentCreate = jest.fn(async (args: any) => {
      capturedPaymentArgs = args;
      return {
        id: 'pay-new', amount: args.data.amount, currency: args.data.currency,
        status: args.data.status, paymentType: args.data.paymentType,
        createdAt: new Date('2026-06-18T00:00:00Z'),
        verificationStatus: args.data.verificationStatus,
        receiptDocumentId:  args.data.receiptDocumentId,
      };
    });
    const { service } = makeService({
      caseRow:     { id: 'case-1', leadId: 'lead-x' },
      documentRow: VALID_RECEIPT,
      paymentCreate,
    });

    const result = await service.recordManualPayment(
      'case-1',
      { amount: 25000, currency: 'NZD', note: 'Cash on signing', receiptDocumentId: 'doc-receipt-1' },
      ACTOR,
    );

    expect(capturedPaymentArgs.data.leadId).toBe('lead-x');
    expect(capturedPaymentArgs.data.caseId).toBe('case-1');
    expect(capturedPaymentArgs.data.paymentType).toBe('manual');
    expect(capturedPaymentArgs.data.status).toBe('succeeded');
    expect(capturedPaymentArgs.data.amount).toBe(25000);
    expect(capturedPaymentArgs.data.currency).toBe('nzd');
    // Phase 6.5 — new fields on the write.
    expect(capturedPaymentArgs.data.verificationStatus).toBe('PENDING');
    expect(capturedPaymentArgs.data.receiptDocumentId).toBe('doc-receipt-1');

    expect(result.isManual).toBe(true);
    expect(result).toEqual(expect.objectContaining({
      id: 'pay-new', amount: 25000, currency: 'nzd', status: 'succeeded',
      paymentType: 'manual', isManual: true,
      verificationStatus: 'PENDING',
      receiptDocumentId:  'doc-receipt-1',
    }));
  });

  it('synthesises a stripePaymentIntentId prefixed `manual_` (won\'t collide with real `pi_...` ids)', async () => {
    let capturedPaymentArgs: any = null;
    const paymentCreate = jest.fn(async (args: any) => {
      capturedPaymentArgs = args;
      return {
        id: 'pay-new', amount: args.data.amount, currency: args.data.currency,
        status: args.data.status, paymentType: args.data.paymentType,
        createdAt: new Date(),
        verificationStatus: 'PENDING',
        receiptDocumentId:  args.data.receiptDocumentId,
      };
    });
    const { service } = makeService({
      caseRow:     { id: 'case-1', leadId: 'lead-x' },
      documentRow: VALID_RECEIPT,
      paymentCreate,
    });

    await service.recordManualPayment(
      'case-1',
      { amount: 100, receiptDocumentId: 'doc-receipt-1' },
      ACTOR,
    );

    const intentId: string = capturedPaymentArgs.data.stripePaymentIntentId;
    expect(intentId).toMatch(/^manual_[0-9a-f-]{36}$/);
    expect(intentId.startsWith('pi_')).toBe(false);
  });

  it('records actor attribution in metadata + writes ONE audit row in the same transaction (with new audit fields)', async () => {
    let capturedPaymentArgs: any = null;
    const paymentCreate = jest.fn(async (args: any) => {
      capturedPaymentArgs = args;
      return {
        id: 'pay-new', amount: args.data.amount, currency: args.data.currency,
        status: args.data.status, paymentType: args.data.paymentType,
        createdAt: new Date(),
        verificationStatus: 'PENDING',
        receiptDocumentId:  args.data.receiptDocumentId,
      };
    });
    const auditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });

    const { service, prisma } = makeService({
      caseRow:     { id: 'case-1', leadId: 'lead-x' },
      documentRow: VALID_RECEIPT,
      paymentCreate,
      auditCreate,
    });

    await service.recordManualPayment(
      'case-1',
      { amount: 12345, note: 'wire', receiptDocumentId: 'doc-receipt-1' },
      { id: 'staff-2', name: 'Eve Auditor', role: 'ADMIN' },
    );

    const meta = capturedPaymentArgs.data.metadata;
    expect(meta.manual).toBe(true);
    expect(meta.actorId).toBe('staff-2');
    expect(meta.actorName).toBe('Eve Auditor');
    expect(meta.actorRole).toBe('ADMIN');
    expect(meta.note).toBe('wire');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(paymentCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);

    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit.action).toBe('CREATE');
    expect(audit.eventType).toBe('PAYMENT_RECORDED_MANUAL');
    expect(audit.entityType).toBe('PAYMENT');
    expect(audit.entityId).toBe('pay-new');
    expect(audit.userId).toBe('staff-2');
    expect(audit.actorNameSnapshot).toBe('Eve Auditor');
    expect(audit.actorRoleSnapshot).toBe('ADMIN');
    expect(audit.newValue).toEqual({
      caseId: 'case-1', leadId: 'lead-x', paymentType: 'manual',
      amount: 12345, currency: 'nzd', hasNote: true,
      receiptDocumentId: 'doc-receipt-1',
      verificationStatus: 'PENDING',
    });
  });

  it('omits `note` field from metadata when not provided', async () => {
    let capturedPaymentArgs: any = null;
    const paymentCreate = jest.fn(async (args: any) => {
      capturedPaymentArgs = args;
      return {
        id: 'pay-new', amount: args.data.amount, currency: args.data.currency,
        status: args.data.status, paymentType: args.data.paymentType,
        createdAt: new Date(),
        verificationStatus: 'PENDING',
        receiptDocumentId:  args.data.receiptDocumentId,
      };
    });
    const { service } = makeService({
      caseRow:     { id: 'case-1', leadId: 'lead-x' },
      documentRow: VALID_RECEIPT,
      paymentCreate,
    });

    await service.recordManualPayment(
      'case-1',
      { amount: 100, receiptDocumentId: 'doc-receipt-1' },
      ACTOR,
    );

    const meta = capturedPaymentArgs.data.metadata;
    expect(meta).not.toHaveProperty('note');
  });

  it('throws 404 NotFoundException when the case does not exist (no Payment row written)', async () => {
    const paymentCreate = jest.fn();
    const { service } = makeService({
      caseRow: null,
      paymentCreate,
    });

    await expect(
      service.recordManualPayment(
        'case-missing',
        { amount: 100, receiptDocumentId: 'doc-receipt-1' },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(paymentCreate).not.toHaveBeenCalled();
  });

  // ─── Phase 6.5 — receipt validation ──────────────────────────────────

  it('throws 404 when the receipt document does not exist (no Payment row written)', async () => {
    const paymentCreate = jest.fn();
    const { service } = makeService({
      caseRow:     { id: 'case-1', leadId: 'lead-x' },
      documentRow: null,                                       // receipt not found
      paymentCreate,
    });

    await expect(
      service.recordManualPayment(
        'case-1',
        { amount: 100, receiptDocumentId: 'doc-missing' },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it('throws 400 BadRequest when the receipt belongs to ANOTHER case (cross-tenant attach attempt)', async () => {
    const paymentCreate = jest.fn();
    const { service } = makeService({
      caseRow:     { id: 'case-1', leadId: 'lead-x' },
      documentRow: { id: 'doc-foreign', caseId: 'case-99', status: 'UPLOADED' },
      paymentCreate,
    });

    await expect(
      service.recordManualPayment(
        'case-1',
        { amount: 100, receiptDocumentId: 'doc-foreign' },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it('throws 400 BadRequest when the receipt upload is still PENDING (half-finished upload)', async () => {
    const paymentCreate = jest.fn();
    const { service } = makeService({
      caseRow:     { id: 'case-1', leadId: 'lead-x' },
      documentRow: { id: 'doc-receipt-1', caseId: 'case-1', status: 'PENDING' },
      paymentCreate,
    });

    await expect(
      service.recordManualPayment(
        'case-1',
        { amount: 100, receiptDocumentId: 'doc-receipt-1' },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it('defaults currency to "nzd" when omitted; lowercases when provided uppercase', async () => {
    let capturedPaymentArgs: any = null;
    const paymentCreate = jest.fn(async (args: any) => {
      capturedPaymentArgs = args;
      return {
        id: 'pay-new', amount: args.data.amount, currency: args.data.currency,
        status: args.data.status, paymentType: args.data.paymentType,
        createdAt: new Date(),
        verificationStatus: 'PENDING',
        receiptDocumentId:  args.data.receiptDocumentId,
      };
    });
    const { service } = makeService({
      caseRow:     { id: 'case-1', leadId: 'lead-x' },
      documentRow: VALID_RECEIPT,
      paymentCreate,
    });

    await service.recordManualPayment(
      'case-1',
      { amount: 100, receiptDocumentId: 'doc-receipt-1' },
      ACTOR,
    );
    expect(capturedPaymentArgs.data.currency).toBe('nzd');

    await service.recordManualPayment(
      'case-1',
      { amount: 100, currency: 'USD', receiptDocumentId: 'doc-receipt-1' },
      ACTOR,
    );
    expect(capturedPaymentArgs.data.currency).toBe('usd');
  });
});

// ─── createConsultationLinkForCase (unchanged from Phase 6) ─────────────

describe('PaymentsService.createConsultationLinkForCase', () => {
  it('resolves leadId from caseId and delegates to stripe with caseId as the 5th arg', async () => {
    const { service, stripe, caseFindUnique } = makeService({
      caseRow: { id: 'case-99', leadId: 'lead-from-case' },
    });
    stripe.createConsultationPaymentLink.mockResolvedValue({
      url: 'https://buy.stripe.com/test_link_abc',
    });

    const result = await service.createConsultationLinkForCase(
      'case-99',
      'ADMISSION_CONSULTATION',
    );

    expect(caseFindUnique).toHaveBeenCalledWith({
      where:  { id: 'case-99' },
      select: { leadId: true },
    });
    expect(stripe.createConsultationPaymentLink).toHaveBeenCalledTimes(1);
    expect(stripe.createConsultationPaymentLink).toHaveBeenCalledWith(
      'lead-from-case', 'ADMISSION_CONSULTATION', 50, 'nzd', 'case-99',
    );
    expect(result).toEqual({
      url: 'https://buy.stripe.com/test_link_abc',
      free: false,
      consultationType: 'ADMISSION_CONSULTATION',
    });
  });

  it('throws NotFoundException when the case does not exist (no stripe call)', async () => {
    const { service, stripe } = makeService({ caseRow: null });
    await expect(
      service.createConsultationLinkForCase('case-missing', 'GAP_CLOSING'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(stripe.createConsultationPaymentLink).not.toHaveBeenCalled();
  });

  it('passes consultationType through unchanged', async () => {
    const { service, stripe } = makeService({
      caseRow: { id: 'case-7', leadId: 'lead-7' },
    });
    stripe.createConsultationPaymentLink.mockResolvedValue({
      url: 'https://buy.stripe.com/test_link_xyz',
    });
    await service.createConsultationLinkForCase('case-7', 'LIA_CONSULTATION');
    expect(stripe.createConsultationPaymentLink.mock.calls[0][1]).toBe('LIA_CONSULTATION');
  });

  it('returns the FREE shape without calling stripe when consultationType is FREE_SESSION', async () => {
    const { service, stripe } = makeService({
      caseRow: { id: 'case-free', leadId: 'lead-free' },
    });
    const result = await service.createConsultationLinkForCase('case-free', 'FREE_SESSION');
    expect(stripe.createConsultationPaymentLink).not.toHaveBeenCalled();
    expect(result).toEqual({ url: null, free: true, consultationType: 'FREE_SESSION' });
  });
});

// ─── createCustomLinkForCase ────────────────────────────────────────────
//
// Parallel to createConsultationLinkForCase but for arbitrary amounts.
// Same case→leadId resolution; delegates to a DIFFERENT stripe method
// (createCustomAmountPaymentLink — inline price_data instead of a
// pre-created Stripe Price).

describe('PaymentsService.createCustomLinkForCase', () => {
  it('resolves leadId from caseId and delegates to stripe.createCustomAmountPaymentLink with the right args', async () => {
    const { service, stripe, caseFindUnique } = makeService({
      caseRow: { id: 'case-99', leadId: 'lead-from-case' },
    });
    // Extend the stripe mock with the new method — makeService only
    // wires createConsultationPaymentLink by default.
    stripe.createCustomAmountPaymentLink = jest.fn().mockResolvedValue({
      url: 'https://buy.stripe.com/test_custom_link',
    });

    const result = await service.createCustomLinkForCase(
      'case-99',
      7500,        // $75.00 NZD in integer cents
      'nzd',
    );

    // Case lookup uses the right id + selects only leadId.
    expect(caseFindUnique).toHaveBeenCalledWith({
      where:  { id: 'case-99' },
      select: { leadId: true },
    });

    // Stripe was called with (leadId, caseId, amountCents, currency).
    expect(stripe.createCustomAmountPaymentLink).toHaveBeenCalledTimes(1);
    expect(stripe.createCustomAmountPaymentLink).toHaveBeenCalledWith(
      'lead-from-case',
      'case-99',
      7500,
      'nzd',
    );

    // Returned shape includes the resolved URL + the amount/currency
    // the caller passed in (so the frontend can echo them on success).
    expect(result).toEqual({
      url:      'https://buy.stripe.com/test_custom_link',
      amount:   7500,
      currency: 'nzd',
    });
  });

  it('throws NotFoundException when the case does not exist (no stripe call)', async () => {
    const { service, stripe } = makeService({ caseRow: null });
    stripe.createCustomAmountPaymentLink = jest.fn();

    await expect(
      service.createCustomLinkForCase('case-missing', 5000),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(stripe.createCustomAmountPaymentLink).not.toHaveBeenCalled();
  });

  it('defaults currency to "nzd" when the caller omits it', async () => {
    const { service, stripe } = makeService({
      caseRow: { id: 'case-1', leadId: 'lead-1' },
    });
    stripe.createCustomAmountPaymentLink = jest.fn().mockResolvedValue({
      url: 'https://buy.stripe.com/test_default_currency',
    });

    await service.createCustomLinkForCase('case-1', 5000);

    expect(stripe.createCustomAmountPaymentLink).toHaveBeenCalledWith(
      'lead-1',
      'case-1',
      5000,
      'nzd',
    );
  });
});

// ─── confirmPayment ─────────────────────────────────────────────────────

describe('PaymentsService.confirmPayment', () => {
  it('PENDING → CONFIRMED: writes verifier id + verifiedAt + note, emits audit row', async () => {
    let capturedUpdate: any = null;
    const paymentUpdate = jest.fn(async (args: any) => {
      capturedUpdate = args;
      return {
        id: 'pay-1',
        verificationStatus: args.data.verificationStatus,
        verifiedById:       args.data.verifiedById,
        verifiedAt:         args.data.verifiedAt,
        verificationNote:   args.data.verificationNote,
      };
    });
    const auditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });

    const { service, prisma } = makeService({
      paymentRow:    { id: 'pay-1', caseId: 'case-1', verificationStatus: 'PENDING' },
      paymentUpdate,
      auditCreate,
    });

    const result = await service.confirmPayment(
      'pay-1',
      { id: 'fin-1', name: 'Mira Finance', role: 'FINANCE' },
      'All good — bank statement matches.',
    );

    expect(capturedUpdate.where).toEqual({ id: 'pay-1' });
    expect(capturedUpdate.data.verificationStatus).toBe('CONFIRMED');
    expect(capturedUpdate.data.verifiedById).toBe('fin-1');
    expect(capturedUpdate.data.verifiedAt).toBeInstanceOf(Date);
    expect(capturedUpdate.data.verificationNote).toBe('All good — bank statement matches.');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(paymentUpdate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);

    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit.eventType).toBe('PAYMENT_VERIFICATION_CONFIRMED');
    expect(audit.action).toBe('UPDATE');
    expect(audit.entityType).toBe('PAYMENT');
    expect(audit.entityId).toBe('pay-1');
    expect(audit.userId).toBe('fin-1');
    expect(audit.actorNameSnapshot).toBe('Mira Finance');
    expect(audit.actorRoleSnapshot).toBe('FINANCE');
    expect(audit.newValue).toEqual({
      paymentId: 'pay-1',
      caseId:    'case-1',
      previousStatus: 'PENDING',
      newStatus:      'CONFIRMED',
      hasNote: true,
    });

    expect(result.verificationStatus).toBe('CONFIRMED');
  });

  it('note is OPTIONAL on confirm; absent note → null in the update + hasNote=false in audit', async () => {
    let capturedUpdate: any = null;
    const paymentUpdate = jest.fn(async (args: any) => {
      capturedUpdate = args;
      return {
        id: 'pay-1',
        verificationStatus: args.data.verificationStatus,
        verifiedById:       args.data.verifiedById,
        verifiedAt:         args.data.verifiedAt,
        verificationNote:   args.data.verificationNote,
      };
    });
    const auditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const { service } = makeService({
      paymentRow: { id: 'pay-1', caseId: 'case-1', verificationStatus: 'PENDING' },
      paymentUpdate,
      auditCreate,
    });

    await service.confirmPayment(
      'pay-1',
      { id: 'fin-1', name: 'Mira Finance', role: 'FINANCE' },
    );

    expect(capturedUpdate.data.verificationNote).toBeNull();
    expect(auditCreate.mock.calls[0][0].data.newValue.hasNote).toBe(false);
  });

  it('throws 404 NotFoundException when the payment does not exist', async () => {
    const paymentUpdate = jest.fn();
    const { service } = makeService({
      paymentRow:    null,
      paymentUpdate,
    });
    await expect(
      service.confirmPayment('pay-missing', ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it('throws 409 ConflictException when payment is already CONFIRMED', async () => {
    const paymentUpdate = jest.fn();
    const { service } = makeService({
      paymentRow:    { id: 'pay-1', caseId: 'case-1', verificationStatus: 'CONFIRMED' },
      paymentUpdate,
    });
    await expect(
      service.confirmPayment('pay-1', ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it('throws 409 ConflictException when payment is already REJECTED', async () => {
    const paymentUpdate = jest.fn();
    const { service } = makeService({
      paymentRow:    { id: 'pay-1', caseId: 'case-1', verificationStatus: 'REJECTED' },
      paymentUpdate,
    });
    await expect(
      service.confirmPayment('pay-1', ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(paymentUpdate).not.toHaveBeenCalled();
  });
});

// ─── rejectPayment ──────────────────────────────────────────────────────

describe('PaymentsService.rejectPayment', () => {
  it('PENDING → REJECTED: writes verifier id + verifiedAt + reason, emits audit row', async () => {
    let capturedUpdate: any = null;
    const paymentUpdate = jest.fn(async (args: any) => {
      capturedUpdate = args;
      return {
        id: 'pay-1',
        verificationStatus: args.data.verificationStatus,
        verifiedById:       args.data.verifiedById,
        verifiedAt:         args.data.verifiedAt,
        verificationNote:   args.data.verificationNote,
      };
    });
    const auditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });

    const { service } = makeService({
      paymentRow: { id: 'pay-1', caseId: 'case-1', verificationStatus: 'PENDING' },
      paymentUpdate,
      auditCreate,
    });

    const result = await service.rejectPayment(
      'pay-1',
      { id: 'fin-1', name: 'Mira Finance', role: 'FINANCE' },
      'Receipt does not match the amount.',
    );

    expect(capturedUpdate.data.verificationStatus).toBe('REJECTED');
    expect(capturedUpdate.data.verifiedById).toBe('fin-1');
    expect(capturedUpdate.data.verifiedAt).toBeInstanceOf(Date);
    expect(capturedUpdate.data.verificationNote).toBe('Receipt does not match the amount.');

    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit.eventType).toBe('PAYMENT_VERIFICATION_REJECTED');
    expect(audit.newValue.newStatus).toBe('REJECTED');
    expect(audit.newValue.hasNote).toBe(true);

    expect(result.verificationStatus).toBe('REJECTED');
  });

  it('rejects a missing/empty/whitespace-only reason with BadRequest (no DB write)', async () => {
    const paymentUpdate = jest.fn();
    const { service } = makeService({
      paymentRow:    { id: 'pay-1', caseId: 'case-1', verificationStatus: 'PENDING' },
      paymentUpdate,
    });

    for (const note of ['', '   ', '\t\n']) {
      await expect(
        service.rejectPayment('pay-1', ACTOR, note),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace from the reason before persisting', async () => {
    let capturedUpdate: any = null;
    const paymentUpdate = jest.fn(async (args: any) => {
      capturedUpdate = args;
      return {
        id: 'pay-1',
        verificationStatus: args.data.verificationStatus,
        verifiedById:       args.data.verifiedById,
        verifiedAt:         args.data.verifiedAt,
        verificationNote:   args.data.verificationNote,
      };
    });
    const { service } = makeService({
      paymentRow:    { id: 'pay-1', caseId: 'case-1', verificationStatus: 'PENDING' },
      paymentUpdate,
    });
    await service.rejectPayment('pay-1', ACTOR, '  amount mismatch  ');
    expect(capturedUpdate.data.verificationNote).toBe('amount mismatch');
  });

  it('throws 409 ConflictException when payment is already CONFIRMED or REJECTED', async () => {
    for (const state of ['CONFIRMED', 'REJECTED']) {
      const paymentUpdate = jest.fn();
      const { service } = makeService({
        paymentRow:    { id: 'pay-1', caseId: 'case-1', verificationStatus: state },
        paymentUpdate,
      });
      await expect(
        service.rejectPayment('pay-1', ACTOR, 'reason'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(paymentUpdate).not.toHaveBeenCalled();
    }
  });

  it('throws 404 NotFoundException when the payment does not exist', async () => {
    const paymentUpdate = jest.fn();
    const { service } = makeService({
      paymentRow:    null,
      paymentUpdate,
    });
    await expect(
      service.rejectPayment('pay-missing', ACTOR, 'reason'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(paymentUpdate).not.toHaveBeenCalled();
  });
});
