import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvoicesService, INVOICE_STAFF_ROLES } from './invoices.service';

// PR-TAX-INVOICE — what these tests are for.
//
// The renderer's pixels are checked by eye. What cannot be checked by eye is who
// gets the bytes, and whether the document can ever disagree with the row it is
// rendered from. That is what is asserted here:
//
//   1. A foreign invoice is NOT FOUND, never FORBIDDEN — a 403 would confirm
//      that somebody else's invoice exists.
//   2. Staff access is the money tier only.
//   3. Nothing is persisted. The invoice row is read, never written.
//   4. A failed audit write does not deny a client their own invoice.

const OWNER_USER = 'user-owner';

const INVOICE = {
  id: 'inv-1',
  invoiceNumber: 'ENG-2026-0042',
  description: 'Account opening fee',
  amount: '200',
  currency: 'USD',
  status: 'SENT',
  issuedAt: new Date('2026-08-13T00:00:00Z'),
  dueDate: new Date('2026-08-27T00:00:00Z'),
  paidAt: null,
  contact: { userId: OWNER_USER, fullName: 'Amira Haddad', email: 'amira@example.com' },
};

function build(overrides: { invoice?: any; auditThrows?: boolean } = {}) {
  const writes: string[] = [];
  const audits: any[] = [];
  const invoice = 'invoice' in overrides ? overrides.invoice : INVOICE;

  const prisma: any = {
    invoice: {
      findUnique: jest.fn().mockResolvedValue(invoice),
      // Any write on the invoice is a design violation — nothing is stored.
      update: jest.fn(() => { writes.push('invoice.update'); return Promise.resolve({}); }),
      create: jest.fn(() => { writes.push('invoice.create'); return Promise.resolve({}); }),
    },
    auditLog: {
      create: jest.fn((args: any) => {
        if (overrides.auditThrows) return Promise.reject(new Error('audit table down'));
        audits.push(args.data);
        return Promise.resolve({});
      }),
    },
  };

  const settings: any = {
    getBankDetails: jest.fn().mockResolvedValue({
      bankName: 'Kiwibank',
      bankAddress: 'Wellington',
      accountName: 'SORENASTUDY LIMITED',
      accountNumber: '38-9022-0355698-01',
      swift: 'KIWINZ22',
    }),
  };

  return { service: new InvoicesService(prisma, settings), prisma, settings, writes, audits };
}

const actor = (role: string, id = OWNER_USER) => ({ id, name: 'Test', role, secondaryRoles: [] });

describe('InvoicesService — who gets the document', () => {
  it('renders the owner a PDF', async () => {
    const { service } = build();
    const out = await service.renderForClient(OWNER_USER, 'inv-1', actor('LEAD'));

    expect(out.filename).toBe('ENG-2026-0042.pdf');
    // A real PDF, not an empty buffer or a stub.
    expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(out.buffer.length).toBeGreaterThan(1000);
  });

  it("answers NOT FOUND — not FORBIDDEN — for somebody else's invoice", async () => {
    const { service } = build();
    // A 403 here would confirm the invoice exists. It must be indistinguishable
    // from an id that was never issued.
    await expect(service.renderForClient('user-stranger', 'inv-1', actor('LEAD', 'user-stranger')))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers NOT FOUND for an invoice that does not exist', async () => {
    const { service } = build({ invoice: null });
    await expect(service.renderForClient(OWNER_USER, 'nope', actor('LEAD')))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers NOT FOUND when there is no session user at all', async () => {
    const { service, prisma } = build();
    await expect(service.renderForClient(null, 'inv-1', actor('LEAD', '')))
      .rejects.toBeInstanceOf(NotFoundException);
    // And does not even look the invoice up.
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
  });

  it.each(INVOICE_STAFF_ROLES)('lets %s read any invoice', async (role) => {
    const { service } = build();
    const out = await service.renderForStaff('inv-1', actor(role, 'staff-1'));
    expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it.each(['SALES', 'CONSULTANT', 'LIA', 'AGENT', 'STUDENT'])(
    'refuses %s on the staff route', async (role) => {
      const { service, prisma } = build();
      await expect(service.renderForStaff('inv-1', actor(role, 'staff-1')))
        .rejects.toBeInstanceOf(ForbiddenException);
      // Rejected before the row is read.
      expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
    });

  it('honours a secondary FINANCE role', async () => {
    const { service } = build();
    const out = await service.renderForStaff('inv-1', {
      id: 'staff-1', name: 'Ops', role: 'CONSULTANT', secondaryRoles: ['FINANCE'],
    });
    expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('InvoicesService — the document cannot drift from the row', () => {
  it('stores nothing: the invoice is read, never written', async () => {
    const { service, writes } = build();
    await service.renderForClient(OWNER_USER, 'inv-1', actor('LEAD'));
    expect(writes).toEqual([]);
  });

  it('reads the bank details live on every generation', async () => {
    const { service, settings } = build();
    await service.renderForClient(OWNER_USER, 'inv-1', actor('LEAD'));
    await service.renderForClient(OWNER_USER, 'inv-1', actor('LEAD'));
    // Twice, not cached — an admin editing the account changes the next download.
    expect(settings.getBankDetails).toHaveBeenCalledTimes(2);
  });

  it('records an audit row carrying the status it printed', async () => {
    const { service, audits } = build();
    await service.renderForClient(OWNER_USER, 'inv-1', actor('LEAD'));

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      eventType: 'INVOICE_PDF_GENERATED',
      entityType: 'Invoice',
      entityId: 'inv-1',
      userId: OWNER_USER,
    });
    expect(audits[0].newValue).toMatchObject({
      invoiceNumber: 'ENG-2026-0042', via: 'client', status: 'SENT',
    });
  });

  it('distinguishes a staff download from a client one in the audit', async () => {
    const { service, audits } = build();
    await service.renderForStaff('inv-1', actor('FINANCE', 'staff-1'));
    expect(audits[0].newValue).toMatchObject({ via: 'staff' });
    expect(audits[0].userId).toBe('staff-1');
  });

  it('still serves the PDF when the audit write fails', async () => {
    // A broken audit table must not stand between a client and their own
    // invoice. It is logged, not raised.
    const { service } = build({ auditThrows: true });
    const out = await service.renderForClient(OWNER_USER, 'inv-1', actor('LEAD'));
    expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
