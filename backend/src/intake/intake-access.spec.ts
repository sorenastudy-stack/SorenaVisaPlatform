import { PrismaClient } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { assertLeadReadable } from '../leads/assert-lead-read';

/**
 * PR-ACCESS-AUDIT — intake and scoring, scoped to the caller's own leads.
 *
 * /intake/:leadId and /scoring/:leadId were gated by role only. The role gate
 * says who may use intake at all; it never said whose lead. A scoped role could
 * pass any leadId and read the most sensitive derived data the funnel holds —
 * financial capacity, readiness, risk band — on a colleague's client, or
 * overwrite that client's intake answers.
 *
 * Against a real database: the rule is a query and a comparison on its result,
 * and a mocked lead would prove only that a function was called.
 */

jest.setTimeout(60000);

describe('lead-scoped intake + scoring access', () => {
  let prisma: PrismaClient;

  const made = { leads: [] as string[], contacts: [] as string[], users: [] as string[] };

  let salesA: string, salesB: string, consultantA: string;
  let ownerUser: string, financeUser: string;
  let leadOfA: string, leadOfB: string, leadUnowned: string;

  let seq = 0;
  const stamp = () => `ia${Date.now()}_${(seq += 1)}`;

  async function mkUser(role: string, secondaryRoles: string[] = []) {
    const s = stamp();
    const u = await prisma.user.create({
      data: {
        name: `${role} ${s}`, email: `${role.toLowerCase()}.${s}@t.local`,
        passwordHash: 'x', role: role as any, isActive: true,
        secondaryRoles: secondaryRoles as any,
      },
    });
    made.users.push(u.id);
    return u.id;
  }

  async function mkLead(ownerId: string | null) {
    const s = stamp();
    const c = await prisma.contact.create({ data: { fullName: `C ${s}`, email: `c.${s}@t.local` } });
    made.contacts.push(c.id);
    const l = await prisma.lead.create({ data: { contactId: c.id, leadStatus: 'NEW', ownerId } as any });
    made.leads.push(l.id);
    return l.id;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    salesA = await mkUser('SALES');
    salesB = await mkUser('SALES');
    consultantA = await mkUser('CONSULTANT');
    ownerUser = await mkUser('OWNER');
    financeUser = await mkUser('FINANCE');

    leadOfA = await mkLead(salesA);
    leadOfB = await mkLead(salesB);
    leadUnowned = await mkLead(null);
  }, 60000);

  afterAll(async () => {
    await prisma.lead.deleteMany({ where: { id: { in: made.leads } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { id: { in: made.contacts } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => {});
    await prisma.$disconnect();
  });

  const actor = (id: string, role: string, secondaryRoles: string[] = []) =>
    ({ id, role, secondaryRoles });

  it('SALES reaches their own lead', async () => {
    await expect(
      assertLeadReadable(prisma as any, leadOfA, actor(salesA, 'SALES')),
    ).resolves.toBeUndefined();
  });

  it('SALES cannot reach another rep’s lead by id', async () => {
    await expect(
      assertLeadReadable(prisma as any, leadOfB, actor(salesA, 'SALES')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('CONSULTANT cannot reach a lead they do not own', async () => {
    await expect(
      assertLeadReadable(prisma as any, leadOfA, actor(consultantA, 'CONSULTANT')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a scoped role cannot reach an unowned lead either', async () => {
    // ownerId null must not read as "belongs to everyone".
    await expect(
      assertLeadReadable(prisma as any, leadUnowned, actor(salesA, 'SALES')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('oversight roles reach every lead', async () => {
    for (const [id, role] of [[ownerUser, 'OWNER'], [financeUser, 'FINANCE']] as const) {
      for (const lead of [leadOfA, leadOfB, leadUnowned]) {
        await expect(
          assertLeadReadable(prisma as any, lead, actor(id, role)),
        ).resolves.toBeUndefined();
      }
    }
  });

  it('a SECONDARY oversight role widens a scoped one', async () => {
    await expect(
      assertLeadReadable(prisma as any, leadOfB, actor(salesA, 'SALES', ['ADMIN'])),
    ).resolves.toBeUndefined();
  });

  it('answers a denied lead exactly as it answers a missing one', async () => {
    const denied = await assertLeadReadable(prisma as any, leadOfB, actor(salesA, 'SALES')).catch((e) => e);
    const missing = await assertLeadReadable(prisma as any, 'no-such-lead', actor(salesA, 'SALES')).catch((e) => e);
    expect(denied.message).toBe(missing.message);
  });

  it('refuses an unidentifiable caller outright', async () => {
    await expect(
      assertLeadReadable(prisma as any, leadOfA, null),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // A scoped role with no id cannot match an owner, and must not fall through.
    await expect(
      assertLeadReadable(prisma as any, leadOfA, { id: null, role: 'SALES' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
