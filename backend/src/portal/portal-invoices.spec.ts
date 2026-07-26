/**
 * PR-PORTAL-PAYMENTS — PortalService.getMyInvoices own-data isolation. DB-backed.
 * Confirms a client only ever sees their OWN invoices (scoped by JWT userId →
 * contact), so one client can never read another's via the portal Payments page.
 */

import { PrismaClient } from '@prisma/client';
import { PortalService } from './portal.service';

jest.setTimeout(60000);

describe('PortalService.getMyInvoices (own-data isolation)', () => {
  let prisma: PrismaClient;
  let svc: PortalService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    svc = new PortalService(prisma as any, {} as any, {} as any, {} as any);
  }, 60000);

  afterAll(async () => { await prisma.$disconnect(); });

  let seq = 0;
  const stamp = () => `pi${Date.now()}_${(seq += 1)}`;

  async function seedClientWithInvoice(): Promise<{ userId: string; invoiceId: string }> {
    const s = stamp();
    const user = await prisma.user.create({ data: { name: `Client ${s}`, email: `u.${s}@t.local`, passwordHash: 'x', role: 'LEAD' as any, isActive: true } });
    const contact = await prisma.contact.create({ data: { fullName: `Client ${s}`, email: `c.${s}@t.local`, userId: user.id } });
    const inv = await prisma.invoice.create({
      data: { contactId: contact.id, invoiceNumber: `INV-${s}`, description: 'Engagement fee', amount: 200, currency: 'usd', status: 'SENT' } as any,
    });
    return { userId: user.id, invoiceId: inv.id };
  }

  it('returns only the caller’s own invoices — never another client’s', async () => {
    const a = await seedClientWithInvoice();
    const b = await seedClientWithInvoice();

    const aInvoices = await svc.getMyInvoices(a.userId);
    const bInvoices = await svc.getMyInvoices(b.userId);

    expect(aInvoices.map((i) => i.id)).toEqual([a.invoiceId]);
    expect(aInvoices.map((i) => i.id)).not.toContain(b.invoiceId); // A can't see B's
    expect(bInvoices.map((i) => i.id)).toEqual([b.invoiceId]);
    expect(bInvoices.map((i) => i.id)).not.toContain(a.invoiceId); // B can't see A's

    // Client-safe shape: amount is a string, no receipt/finance internals leak.
    const row = aInvoices[0] as any;
    expect(typeof row.amount).toBe('string');
    expect(row.receiptFileUrl).toBeUndefined();
    expect(Object.keys(row).sort()).toEqual(['amount', 'currency', 'description', 'dueDate', 'id', 'invoiceNumber', 'status']);
  });

  it('a userId with no contact gets an empty list (no leak, no throw)', async () => {
    expect(await svc.getMyInvoices('nonexistent-user-id')).toEqual([]);
  });
});
