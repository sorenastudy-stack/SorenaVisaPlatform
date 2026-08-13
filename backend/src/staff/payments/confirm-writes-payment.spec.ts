import { ConflictException, NotFoundException } from '@nestjs/common';
import { StaffPaymentsService } from './staff-payments.service';

// PR-AR-BANK-PAYMENT — confirming a bank receipt must record the money.
//
// Before this, confirming flipped the invoice to PAID and wrote nothing else.
// Everything downstream reads Payment rows, so the client's Payments page said
// "No payments yet" to somebody who had paid, the tax-invoice download never
// appeared for them, and the accounting dashboard counted the invoice as
// invoiced but never as received.

const INVOICE = {
  id: 'inv-1',
  status: 'SENT',
  caseId: 'case-1',
  amount: '200',          // PRE-GST base, Decimal dollars
  currency: 'usd',
  receiptMethod: 'bank',
  receiptUploadedAt: new Date('2026-08-13T00:00:00Z'),
  case: { leadId: 'lead-1' },
};

function build(overrides: { invoice?: any; existingPayment?: any } = {}) {
  const payments: any[] = [];
  const audits: any[] = [];
  const invoiceUpdates: any[] = [];
  const invoice = 'invoice' in overrides ? overrides.invoice : INVOICE;

  const tx = {
    invoice: { update: jest.fn((a: any) => { invoiceUpdates.push(a.data); return Promise.resolve({}); }) },
    payment: { create: jest.fn((a: any) => { payments.push(a.data); return Promise.resolve({ id: 'pay-1' }); }) },
    auditLog: { create: jest.fn((a: any) => { audits.push(a.data); return Promise.resolve({}); }) },
  };
  const prisma: any = {
    invoice: { findUnique: jest.fn().mockResolvedValue(invoice) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Fin Ance', role: 'FINANCE' }) },
    payment: { findFirst: jest.fn().mockResolvedValue(overrides.existingPayment ?? null) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const service = new StaffPaymentsService(prisma);
  return { service, prisma, tx, payments, audits, invoiceUpdates };
}

describe('confirming a bank receipt records the payment', () => {
  it('writes a Payment row for the GST-INCLUSIVE total, not the base', async () => {
    const { service, payments } = build();
    await service.confirmInvoicePayment('fin-1', 'inv-1');

    expect(payments).toHaveLength(1);
    const p = payments[0];
    // The invoice says 200 (base). The client transferred 230.
    expect(p.amount).toBe(23000);
    expect(p.gstCents).toBe(3000);
    expect(p.cardFeeCents).toBe(0);       // no card was processed
    expect(p.currency).toBe('usd');
    expect(p.status).toBe('succeeded');
  });

  it('links the payment to the invoice so the Payments page can find it', async () => {
    const { service, payments } = build();
    await service.confirmInvoicePayment('fin-1', 'inv-1');
    // getMyPayments resolves history rows through metadata.invoiceId.
    expect(payments[0].metadata).toMatchObject({ invoiceId: 'inv-1', confirmedFromReceipt: true });
    expect(payments[0].leadId).toBe('lead-1');
    expect(payments[0].caseId).toBe('case-1');
  });

  it('marks it CONFIRMED — finance is verifying at this exact moment', async () => {
    const { service, payments } = build();
    await service.confirmInvoicePayment('fin-1', 'inv-1');
    // PENDING (the column default) would re-queue work that was just done.
    expect(payments[0].verificationStatus).toBe('CONFIRMED');
    expect(payments[0].verifiedById).toBe('fin-1');
    expect(payments[0].verifiedAt).toBeInstanceOf(Date);
  });

  it('uses a synthetic id that cannot collide with a Stripe one', async () => {
    const { service, payments } = build();
    await service.confirmInvoicePayment('fin-1', 'inv-1');
    expect(payments[0].stripePaymentIntentId).toMatch(/^bank_[0-9a-f-]{36}$/);
    expect(payments[0].stripePaymentIntentId.startsWith('pi_')).toBe(false);
  });

  it('records an exchange-house payment under its own type', async () => {
    const { service, payments } = build({ invoice: { ...INVOICE, receiptMethod: 'exchange' } });
    await service.confirmInvoicePayment('fin-1', 'inv-1');
    expect(payments[0].paymentType).toBe('exchange');
  });

  it('records a bank transfer under bank_transfer', async () => {
    const { service, payments } = build();
    await service.confirmInvoicePayment('fin-1', 'inv-1');
    expect(payments[0].paymentType).toBe('bank_transfer');
  });

  it('writes the payment in the SAME transaction as the status flip', async () => {
    const { service, prisma, tx } = build();
    await service.confirmInvoicePayment('fin-1', 'inv-1');
    // An invoice must never be able to read PAID with its money record missing.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.invoice.update).toHaveBeenCalled();
    expect(tx.payment.create).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('still flips the invoice to PAID', async () => {
    const { service, invoiceUpdates } = build();
    const res = await service.confirmInvoicePayment('fin-1', 'inv-1');
    expect(invoiceUpdates[0]).toMatchObject({ status: 'PAID' });
    expect(res).toMatchObject({ ok: true, status: 'PAID', alreadyPaid: false });
  });

  it('audits what was actually received, not just the base', async () => {
    const { service, audits } = build();
    await service.confirmInvoicePayment('fin-1', 'inv-1');
    expect(audits[0].newValue).toMatchObject({
      amountCents: 20000,     // billed base
      receivedCents: 23000,   // what moved
      gstCents: 3000,
      paymentRecorded: true,
    });
  });
});

describe('it never double-counts revenue', () => {
  it('writes no second Payment when one is already linked to the invoice', async () => {
    // Staff may have recorded the same transfer through the manual endpoint.
    const { service, payments, audits } = build({ existingPayment: { id: 'pay-existing' } });
    await service.confirmInvoicePayment('fin-1', 'inv-1');

    expect(payments).toHaveLength(0);
    // ...but the invoice still gets confirmed, and the audit says so.
    expect(audits[0].newValue).toMatchObject({ paymentRecorded: false });
  });

  it('is a no-op on an already-PAID invoice', async () => {
    const { service, payments, prisma } = build({ invoice: { ...INVOICE, status: 'PAID' } });
    const res = await service.confirmInvoicePayment('fin-1', 'inv-1');
    expect(res).toMatchObject({ alreadyPaid: true });
    expect(payments).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('it refuses what it always refused', () => {
  it('404s an invoice that does not exist', async () => {
    const { service } = build({ invoice: null });
    await expect(service.confirmInvoicePayment('fin-1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409s an invoice with no uploaded receipt', async () => {
    const { service, payments } = build({ invoice: { ...INVOICE, receiptUploadedAt: null } });
    await expect(service.confirmInvoicePayment('fin-1', 'inv-1')).rejects.toBeInstanceOf(ConflictException);
    expect(payments).toHaveLength(0);
  });

  it('409s a CANCELLED invoice', async () => {
    const { service, payments } = build({ invoice: { ...INVOICE, status: 'CANCELLED' } });
    await expect(service.confirmInvoicePayment('fin-1', 'inv-1')).rejects.toBeInstanceOf(ConflictException);
    expect(payments).toHaveLength(0);
  });
});
