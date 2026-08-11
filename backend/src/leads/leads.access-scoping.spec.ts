import { PrismaClient } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { CommissionsService } from '../commissions/commissions.service';

/**
 * PR-SALES-ACTIVATION — who can see which leads and which commissions.
 *
 * Against a REAL database, because the thing under test is a Prisma `where`
 * clause: a mock would happily accept a filter that does not narrow anything,
 * and the bug this guards against is precisely a filter that fails to apply.
 *
 * The property that matters is not "SALES can read the funnel" — it is that a
 * salesperson reading the funnel gets THEIR OWN queue and cannot reach anyone
 * else's, including by asking for it. Before this change every entitled role saw
 * all 52 leads; that stayed invisible only because the roles it would have
 * exposed had no users yet.
 */

jest.setTimeout(60000);

describe('Lead + commission access scoping', () => {
  let prisma: PrismaClient;
  let leads: LeadsService;
  let commissions: CommissionsService;

  // Everything created here, torn down in reverse dependency order.
  const made = {
    commissions: [] as string[],
    applications: [] as string[],
    cases: [] as string[],
    leads: [] as string[],
    contacts: [] as string[],
    users: [] as string[],
    programmes: [] as string[],
    providers: [] as string[],
    audit: [] as string[],
  };

  let salesA: string, salesB: string, owner: string, support: string;
  let leadOfA: string, leadOfB: string, leadUnowned: string;
  let commissionOfA: string, commissionOfB: string;

  let seq = 0;
  const stamp = () => `sc${Date.now()}_${(seq += 1)}`;

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
    const l = await prisma.lead.create({
      data: { contactId: c.id, leadStatus: 'NEW', ownerId } as any,
    });
    made.leads.push(l.id);
    return l.id;
  }

  /** A full Commission needs the whole chain it is scoped through. */
  async function mkCommission(leadId: string) {
    const s = stamp();
    const kase = await prisma.case.create({ data: { leadId } });
    made.cases.push(kase.id);
    const prov = await prisma.educationProvider.create({
      data: { name: `Prov ${s}`, providerType: 'UNIVERSITY' } as any,
    });
    made.providers.push(prov.id);
    const prog = await prisma.educationProgramme.create({
      data: {
        providerId: prov.id, name: `Prog ${s}`,
        level: 'BACHELOR', nzqfLevel: 'LEVEL_7',
      } as any,
    });
    made.programmes.push(prog.id);
    const app = await prisma.application.create({
      data: { caseId: kase.id, providerId: prov.id, programmeId: prog.id } as any,
    });
    made.applications.push(app.id);
    const com = await prisma.commission.create({
      data: {
        applicationId: app.id, providerId: prov.id, programmeId: prog.id,
        commissionValue: 10,
      } as any,
    });
    made.commissions.push(com.id);
    return com.id;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    leads = new LeadsService(prisma as any, {} as any, {} as any, {} as any);
    commissions = new CommissionsService(prisma as any, {} as any);

    salesA = await mkUser('SALES');
    salesB = await mkUser('SALES');
    owner = await mkUser('OWNER');
    support = await mkUser('SUPPORT');

    leadOfA = await mkLead(salesA);
    leadOfB = await mkLead(salesB);
    leadUnowned = await mkLead(null);

    commissionOfA = await mkCommission(leadOfA);
    commissionOfB = await mkCommission(leadOfB);
  }, 60000);

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: { in: made.users } } }).catch(() => {});
    await prisma.commission.deleteMany({ where: { id: { in: made.commissions } } }).catch(() => {});
    await prisma.application.deleteMany({ where: { id: { in: made.applications } } }).catch(() => {});
    await prisma.case.deleteMany({ where: { id: { in: made.cases } } }).catch(() => {});
    await prisma.lead.deleteMany({ where: { id: { in: made.leads } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { id: { in: made.contacts } } }).catch(() => {});
    await prisma.educationProgramme.deleteMany({ where: { id: { in: made.programmes } } }).catch(() => {});
    await prisma.educationProvider.deleteMany({ where: { id: { in: made.providers } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => {});
    await prisma.$disconnect();
  });

  const actor = (id: string, role: string, secondaryRoles: string[] = []) =>
    ({ id, role, secondaryRoles, name: role });

  describe('leads', () => {
    it('SALES sees their own leads and no one else’s', async () => {
      const rows = await leads.findAll({}, actor(salesA, 'SALES'));
      const ids = rows.map((r: any) => r.id);

      expect(ids).toContain(leadOfA);
      expect(ids).not.toContain(leadOfB);
      expect(ids).not.toContain(leadUnowned);
      // Nothing at all outside their own queue — not just "not these three".
      expect(rows.every((r: any) => r.ownerId === salesA)).toBe(true);
    });

    it('SALES cannot read another rep’s queue by asking for it', async () => {
      // The dangerous case: `ownerId` is an accepted query parameter, so a
      // scoped filter applied BEFORE it would be silently overwritten.
      const rows = await leads.findAll({ ownerId: salesB }, actor(salesA, 'SALES'));
      expect(rows.every((r: any) => r.ownerId === salesA)).toBe(true);
      expect(rows.map((r: any) => r.id)).not.toContain(leadOfB);
    });

    it('OWNER still sees the whole funnel, including unowned leads', async () => {
      const ids = (await leads.findAll({}, actor(owner, 'OWNER'))).map((r: any) => r.id);
      expect(ids).toEqual(expect.arrayContaining([leadOfA, leadOfB, leadUnowned]));
    });

    it('a SECONDARY oversight role widens a scoped role', async () => {
      // Secondary roles widen everywhere else in this codebase; a gate that
      // ignored them would deny a user access they were explicitly granted.
      const ids = (await leads.findAll({}, actor(salesA, 'SALES', ['ADMIN']))).map((r: any) => r.id);
      expect(ids).toEqual(expect.arrayContaining([leadOfA, leadOfB]));
    });

    it('a role outside the funnel is refused outright', async () => {
      await expect(leads.findAll({}, actor(support, 'SUPPORT')))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a scoped role with no resolvable id is refused, not silently unscoped', async () => {
      // Fail closed: a missing actor id must never fall through to "no filter".
      await expect(leads.findAll({}, { id: null, role: 'SALES', secondaryRoles: [] }))
        .rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('commissions', () => {
    it('SALES sees only commissions arising from leads they own', async () => {
      const rows = await commissions.findAll({} as any, actor(salesA, 'SALES'));
      const ids = rows.map((r: any) => r.id);
      expect(ids).toContain(commissionOfA);
      expect(ids).not.toContain(commissionOfB);
    });

    it('OWNER sees both', async () => {
      const ids = (await commissions.findAll({} as any, actor(owner, 'OWNER'))).map((r: any) => r.id);
      expect(ids).toEqual(expect.arrayContaining([commissionOfA, commissionOfB]));
    });

    it('a role outside the ledger is refused', async () => {
      await expect(commissions.findAll({} as any, actor(support, 'SUPPORT')))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('SALES has no write access — confirm is still money-tier only', async () => {
      await expect(commissions.confirmCommission(commissionOfA, salesA, 'SALES'))
        .rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
