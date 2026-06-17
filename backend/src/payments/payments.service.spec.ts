/**
 * Phase 6 pilot UI — unit tests for the two new PaymentsService methods.
 *
 * Pattern matches the other service specs (auth, portal, documents):
 * hand-rolled prisma + stripe mocks, direct construction, no Nest boot.
 */

import { NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

// ─── Helpers ────────────────────────────────────────────────────────────

function makeService(opts: {
  payments?: Array<Record<string, unknown>>;
  caseRow?: { id: string; leadId: string } | null;
  paymentCreate?: jest.Mock;
  auditCreate?: jest.Mock;
}) {
  const findMany = jest.fn().mockResolvedValue(opts.payments ?? []);
  const findUnique = jest.fn().mockResolvedValue(opts.caseRow ?? null);
  const paymentCreate = opts.paymentCreate ?? jest.fn(async ({ data, select }: any) => ({
    id:          'pay-new',
    amount:      data.amount,
    currency:    data.currency,
    status:      data.status,
    paymentType: data.paymentType,
    createdAt:   new Date('2026-06-18T00:00:00Z'),
  }));
  const auditCreate = opts.auditCreate ?? jest.fn().mockResolvedValue({ id: 'audit-1' });

  const prismaMock: any = {
    payment: { findMany, create: paymentCreate },
    case:    { findUnique },
    auditLog: { create: auditCreate },
    $transaction: jest.fn(async (cb: any) => cb({
      payment:  { create: paymentCreate },
      auditLog: { create: auditCreate },
    })),
  };

  const stripeMock: any = {
    createConsultationPaymentLink: jest.fn(),
  };

  const service = new PaymentsService(stripeMock, prismaMock);
  return { service, prisma: prismaMock, stripe: stripeMock,
           findMany, findUnique, paymentCreate, auditCreate };
}

const ACTOR = { id: 'staff-1', name: 'Staff One', role: 'FINANCE' as string | null };

// ─── listPaymentsForCase ────────────────────────────────────────────────

describe('PaymentsService.listPaymentsForCase', () => {
  it('returns whitelisted shape with isManual flag derived correctly', async () => {
    const directPayment = {
      id: 'pay-direct', amount: 20000, currency: 'nzd', status: 'succeeded',
      paymentType: 'ACCOUNT_OPENING',
      createdAt: new Date('2026-06-15T10:00:00Z'),
    };
    const indirectPayment = {
      id: 'pay-indirect', amount: 5000, currency: 'nzd', status: 'succeeded',
      paymentType: 'consultation',
      createdAt: new Date('2026-06-10T10:00:00Z'),
    };
    const manualPayment = {
      id: 'pay-manual', amount: 30000, currency: 'nzd', status: 'succeeded',
      paymentType: 'manual',
      createdAt: new Date('2026-06-17T10:00:00Z'),
    };
    // Sorted newest first; manual is between the other two.
    const { service, findMany } = makeService({
      payments: [manualPayment, directPayment, indirectPayment],
    });

    const rows = await service.listPaymentsForCase('case-1');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      id: 'pay-manual', amount: 30000, currency: 'nzd', status: 'succeeded',
      paymentType: 'manual',
      createdAt: new Date('2026-06-17T10:00:00Z'),
      isManual: true,
    });
    expect(rows[1].paymentType).toBe('ACCOUNT_OPENING');
    expect(rows[1].isManual).toBe(false);
    expect(rows[2].paymentType).toBe('consultation');
    expect(rows[2].isManual).toBe(false);

    // No raw Stripe metadata leaks.
    for (const r of rows) {
      expect(r).not.toHaveProperty('metadata');
      expect(r).not.toHaveProperty('stripePaymentIntentId');
      expect(r).not.toHaveProperty('leadId');
      expect(r).not.toHaveProperty('caseId');
    }

    // The WHERE clause ORs the two link paths (direct caseId + lead.cases).
    const where = findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      OR: [
        { caseId: 'case-1' },
        { lead: { cases: { some: { id: 'case-1' } } } },
      ],
    });
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });

  it('returns [] when there are no payments for the case', async () => {
    const { service } = makeService({ payments: [] });
    const rows = await service.listPaymentsForCase('case-empty');
    expect(rows).toEqual([]);
  });

  it('the OR query excludes payments from other cases/leads (the prisma WHERE is what enforces it)', async () => {
    // We can't observe the DB from a mock, but we CAN assert that
    // the where clause carries the case-id-restriction on BOTH sides
    // of the OR — i.e. there's no way an unrelated payment slips
    // through because the query asked for "all payments".
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
  it('resolves leadId from caseId and writes a Payment row with correct manual fields', async () => {
    let capturedPaymentArgs: any = null;
    const paymentCreate = jest.fn(async (args: any) => {
      capturedPaymentArgs = args;
      return {
        id: 'pay-new', amount: args.data.amount, currency: args.data.currency,
        status: args.data.status, paymentType: args.data.paymentType,
        createdAt: new Date('2026-06-18T00:00:00Z'),
      };
    });
    const { service } = makeService({
      caseRow:       { id: 'case-1', leadId: 'lead-x' },
      paymentCreate,
    });

    const result = await service.recordManualPayment(
      'case-1',
      { amount: 25000, currency: 'NZD', note: 'Cash on signing' },
      ACTOR,
    );

    expect(capturedPaymentArgs.data.leadId).toBe('lead-x');        // resolved from case
    expect(capturedPaymentArgs.data.caseId).toBe('case-1');        // direct link
    expect(capturedPaymentArgs.data.paymentType).toBe('manual');
    expect(capturedPaymentArgs.data.status).toBe('succeeded');
    expect(capturedPaymentArgs.data.amount).toBe(25000);
    expect(capturedPaymentArgs.data.currency).toBe('nzd');         // lowercased

    expect(result.isManual).toBe(true);
    expect(result).toEqual(expect.objectContaining({
      id: 'pay-new', amount: 25000, currency: 'nzd', status: 'succeeded',
      paymentType: 'manual', isManual: true,
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
      };
    });
    const { service } = makeService({
      caseRow: { id: 'case-1', leadId: 'lead-x' },
      paymentCreate,
    });

    await service.recordManualPayment('case-1', { amount: 100 }, ACTOR);

    const intentId: string = capturedPaymentArgs.data.stripePaymentIntentId;
    expect(intentId).toMatch(/^manual_[0-9a-f-]{36}$/);
    expect(intentId.startsWith('pi_')).toBe(false);
  });

  it('records actor attribution in metadata + writes ONE audit row in the same transaction', async () => {
    let capturedPaymentArgs: any = null;
    const paymentCreate = jest.fn(async (args: any) => {
      capturedPaymentArgs = args;
      return {
        id: 'pay-new', amount: args.data.amount, currency: args.data.currency,
        status: args.data.status, paymentType: args.data.paymentType,
        createdAt: new Date(),
      };
    });
    const auditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });

    const { service, prisma } = makeService({
      caseRow: { id: 'case-1', leadId: 'lead-x' },
      paymentCreate,
      auditCreate,
    });

    await service.recordManualPayment(
      'case-1',
      { amount: 12345, note: 'wire' },
      { id: 'staff-2', name: 'Eve Auditor', role: 'ADMIN' },
    );

    // Metadata: actor attribution + manual flag, optional note.
    const meta = capturedPaymentArgs.data.metadata;
    expect(meta.manual).toBe(true);
    expect(meta.actorId).toBe('staff-2');
    expect(meta.actorName).toBe('Eve Auditor');
    expect(meta.actorRole).toBe('ADMIN');
    expect(meta.note).toBe('wire');

    // Atomic: one $transaction call, with both writes inside.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(paymentCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);

    // Audit shape: action=CREATE, eventType=PAYMENT_RECORDED_MANUAL,
    // actor + amount + caseId in newValue (no raw note text — hasNote bool).
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
      };
    });
    const { service } = makeService({
      caseRow: { id: 'case-1', leadId: 'lead-x' },
      paymentCreate,
    });

    await service.recordManualPayment('case-1', { amount: 100 }, ACTOR);

    const meta = capturedPaymentArgs.data.metadata;
    expect(meta).not.toHaveProperty('note');
  });

  it('throws 404 NotFoundException when the case does not exist (no Payment row written)', async () => {
    const paymentCreate = jest.fn();
    const { service } = makeService({ caseRow: null, paymentCreate });

    await expect(
      service.recordManualPayment('case-missing', { amount: 100 }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);

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
      };
    });
    const { service } = makeService({
      caseRow: { id: 'case-1', leadId: 'lead-x' },
      paymentCreate,
    });

    // (a) omitted → defaults to nzd
    await service.recordManualPayment('case-1', { amount: 100 }, ACTOR);
    expect(capturedPaymentArgs.data.currency).toBe('nzd');

    // (b) uppercase → lowercased
    await service.recordManualPayment('case-1', { amount: 100, currency: 'USD' }, ACTOR);
    expect(capturedPaymentArgs.data.currency).toBe('usd');
  });
});
