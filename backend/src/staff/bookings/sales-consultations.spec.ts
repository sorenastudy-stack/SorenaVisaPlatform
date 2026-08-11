import { PrismaClient } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { StaffBookingsService } from './staff-bookings.service';

/**
 * PR-SALES-CONSULTATIONS — who sees which consultations.
 *
 * Against a real database, for the same reason as the leads/commissions specs:
 * the thing under test is a Prisma `where`, and a mock will happily accept a
 * filter that narrows nothing.
 *
 * The distinction this suite exists to protect is the one that made this a
 * separate method: ownership here means "the lead is mine", NOT "the session is
 * assigned to me". A rep almost never runs the sessions on their own leads — an
 * LIA or an admission officer does — so a filter on assignedToId would show a
 * salesperson an empty page and look correct while doing it.
 */

jest.setTimeout(60000);

describe('Consultations scoped to owned leads', () => {
  let prisma: PrismaClient;
  let service: StaffBookingsService;

  const made = { consultations: [] as string[], leads: [] as string[], contacts: [] as string[], users: [] as string[] };

  let salesA: string, salesB: string, owner: string, finance: string, lia: string, support: string;
  let leadOfA: string, leadOfB: string;
  let consultOfA: string, consultOfB: string, consultUnscheduled: string;

  let seq = 0;
  const stamp = () => `cs${Date.now()}_${(seq += 1)}`;

  async function mkUser(role: string, secondaryRoles: string[] = []) {
    const s = stamp();
    const u = await prisma.user.create({
      data: {
        name: `${role} ${s}`, email: `${role.toLowerCase()}.${s}@t.local`,
        passwordHash: 'x', role: role as any, isActive: true, secondaryRoles: secondaryRoles as any,
      },
    });
    made.users.push(u.id);
    return u.id;
  }

  async function mkLead(ownerId: string) {
    const s = stamp();
    const c = await prisma.contact.create({ data: { fullName: `Client ${s}`, email: `c.${s}@t.local` } });
    made.contacts.push(c.id);
    const l = await prisma.lead.create({ data: { contactId: c.id, leadStatus: 'NEW', ownerId } as any });
    made.leads.push(l.id);
    return l.id;
  }

  async function mkConsultation(leadId: string, over: Record<string, any> = {}) {
    const c = await prisma.consultation.create({
      data: {
        leadId, type: 'ADMISSION', status: 'BOOKED', amountNZD: 50,
        scheduledAt: new Date(Date.now() + 86_400_000),
        ...over,
      } as any,
    });
    made.consultations.push(c.id);
    return c.id;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    service = new StaffBookingsService(prisma as any, {} as any);

    salesA = await mkUser('SALES');
    salesB = await mkUser('SALES');
    owner = await mkUser('OWNER');
    finance = await mkUser('FINANCE');
    lia = await mkUser('LIA');
    support = await mkUser('SUPPORT');

    leadOfA = await mkLead(salesA);
    leadOfB = await mkLead(salesB);

    // The session on A's lead is run by the LIA, not by A. This is the normal
    // shape, and the reason assignedToId is the wrong ownership signal here.
    consultOfA = await mkConsultation(leadOfA, { type: 'LIA', assignedToId: lia });
    consultOfB = await mkConsultation(leadOfB, { assignedToId: lia });
    consultUnscheduled = await mkConsultation(leadOfA, { scheduledAt: null, status: 'BOOKED' });
  }, 60000);

  afterAll(async () => {
    await prisma.consultation.deleteMany({ where: { id: { in: made.consultations } } }).catch(() => {});
    await prisma.lead.deleteMany({ where: { id: { in: made.leads } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { id: { in: made.contacts } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => {});
    await prisma.$disconnect();
  });

  const actor = (userId: string, role: string, secondaryRoles: string[] = []) =>
    ({ userId, role, secondaryRoles });

  it('SALES sees consultations on their own leads and no one else’s', async () => {
    const rows = await service.listForOwnedLeads(actor(salesA, 'SALES'));
    const ids = rows.map((r: any) => r.id);

    expect(ids).toContain(consultOfA);
    expect(ids).not.toContain(consultOfB);
    expect(rows.every((r: any) => r.lead?.ownerId === salesA)).toBe(true);
  });

  it('sees them even though the session is assigned to someone else', async () => {
    // The whole point of scoping on lead ownership: A's LIA session is run by
    // the LIA, so an assignedToId filter would have hidden it from A.
    const rows = await service.listForOwnedLeads(actor(salesA, 'SALES'));
    const row: any = rows.find((r: any) => r.id === consultOfA);
    expect(row).toBeDefined();
    expect(row.assignedTo?.id).toBe(lia);
    expect(row.assignedTo?.id).not.toBe(salesA);
  });

  it('includes an unscheduled consultation', async () => {
    // Work waiting to happen. A date filter would hide precisely the ones that
    // need chasing.
    const ids = (await service.listForOwnedLeads(actor(salesA, 'SALES'))).map((r: any) => r.id);
    expect(ids).toContain(consultUnscheduled);
  });

  it.each([['OWNER'], ['SUPER_ADMIN'], ['ADMIN'], ['FINANCE']])(
    '%s sees every consultation',
    async (role) => {
      const id = role === 'FINANCE' ? finance : owner;
      const ids = (await service.listForOwnedLeads(actor(id, role))).map((r: any) => r.id);
      expect(ids).toEqual(expect.arrayContaining([consultOfA, consultOfB]));
    },
  );

  it('a SECONDARY oversight role widens a scoped role', async () => {
    const ids = (await service.listForOwnedLeads(actor(salesA, 'SALES', ['ADMIN']))).map((r: any) => r.id);
    expect(ids).toEqual(expect.arrayContaining([consultOfA, consultOfB]));
  });

  it('a scoped caller with no resolvable id is refused, not silently unscoped', async () => {
    await expect(service.listForOwnedLeads({ userId: null, role: 'SALES', secondaryRoles: [] }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('carries the client context the page renders', async () => {
    const row: any = (await service.listForOwnedLeads(actor(salesA, 'SALES')))
      .find((r: any) => r.id === consultOfA);
    expect(row.clientName).toMatch(/^Client /);
    expect(row.type).toBe('LIA');
    expect(row.paymentStatus).toBeDefined();
    // Decimal → number, so the page can format it without knowing about Prisma.
    expect(typeof row.amountNZD).toBe('number');
  });

  it('a role with no grant here still gets nothing back through the service', async () => {
    // SUPPORT is not in the controller's allow-list; if it ever reached the
    // service anyway, it must be scoped rather than handed the lot.
    const rows = await service.listForOwnedLeads(actor(support, 'SUPPORT'));
    expect(rows.every((r: any) => r.lead?.ownerId === support)).toBe(true);
    expect(rows.map((r: any) => r.id)).not.toContain(consultOfA);
  });
});
