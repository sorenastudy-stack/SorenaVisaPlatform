import { PrismaClient } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { StaffLeadsService } from './staff-leads.service';
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
  let staffLeads: StaffLeadsService;
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
  let consultant: string, finance: string;
  let leadOfA: string, leadOfB: string, leadUnowned: string, leadOfConsultant: string;
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
    // create() emits a LEAD_CREATED event; only the network-ish deps are stubbed
    // so the ownership decision under test runs for real against the database.
    const events: any = { emit: jest.fn().mockResolvedValue(undefined) };
    leads = new LeadsService(prisma as any, events, {} as any, {} as any);
    staffLeads = new StaffLeadsService(prisma as any);
    commissions = new CommissionsService(prisma as any, {} as any);

    salesA = await mkUser('SALES');
    salesB = await mkUser('SALES');
    owner = await mkUser('OWNER');
    support = await mkUser('SUPPORT');
    consultant = await mkUser('CONSULTANT');
    finance = await mkUser('FINANCE');
    leadOfConsultant = await mkLead(consultant);

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

    it('SALES cannot fetch another rep’s lead BY ID', async () => {
      // The hole that scoping only the list would leave: the detail page fetches
      // GET /leads/:id, so a rep who cannot see a lead in their list could still
      // read it — and everything on it — by guessing or being given the id.
      await expect(leads.findOne(leadOfB, actor(salesA, 'SALES')))
        .rejects.toThrow(/not found/i);
      // Their own lead still resolves.
      await expect(leads.findOne(leadOfA, actor(salesA, 'SALES')))
        .resolves.toMatchObject({ id: leadOfA });
    });

    it('reports another rep’s lead as NOT FOUND, not as forbidden', async () => {
      // "Forbidden" would confirm the record exists. Not-found tells someone
      // with an id they should not have exactly nothing.
      await expect(leads.findOne(leadOfB, actor(salesA, 'SALES')))
        .rejects.toMatchObject({ status: 404 });
    });

    it('SALES cannot read another rep’s lead history', async () => {
      await expect(leads.getHistory(leadOfB, actor(salesA, 'SALES')))
        .rejects.toThrow(/not found/i);
    });

    it('internal callers with no actor still reach any lead', async () => {
      // Nurture sweeps and other internal work legitimately load any lead; they
      // establish their own right to act and must not be broken by user scoping.
      await expect(leads.findOne(leadOfB)).resolves.toMatchObject({ id: leadOfB });
    });

    it('OWNER can still fetch any lead by id', async () => {
      await expect(leads.findOne(leadOfB, actor(owner, 'OWNER')))
        .resolves.toMatchObject({ id: leadOfB });
    });

    it('a scoped role with no resolvable id is refused, not silently unscoped', async () => {
      // Fail closed: a missing actor id must never fall through to "no filter".
      await expect(leads.findAll({}, { id: null, role: 'SALES', secondaryRoles: [] }))
        .rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('lead creation ownership', () => {
    async function mkContact() {
      const s = stamp();
      const c = await prisma.contact.create({ data: { fullName: `NC ${s}`, email: `nc.${s}@t.local` } });
      made.contacts.push(c.id);
      return c.id;
    }

    it('SALES cannot create a lead owned by someone else, even by sending ownerId', async () => {
      const contactId = await mkContact();
      const lead: any = await leads.create(
        { contactId, ownerId: salesB } as any,
        actor(salesA, 'SALES') as any,
      );
      made.leads.push(lead.id);
      // The payload asked for salesB; the server decided salesA.
      expect(lead.ownerId).toBe(salesA);
      expect(lead.ownerId).not.toBe(salesB);
    });

    it('SALES omitting ownerId still owns what they create', async () => {
      const contactId = await mkContact();
      const lead: any = await leads.create({ contactId } as any, actor(salesA, 'SALES') as any);
      made.leads.push(lead.id);
      expect(lead.ownerId).toBe(salesA);
    });

    it('the lead SALES just created is visible to them and not to the other rep', async () => {
      const contactId = await mkContact();
      const lead: any = await leads.create(
        { contactId, ownerId: salesB } as any,
        actor(salesA, 'SALES') as any,
      );
      made.leads.push(lead.id);
      const mine = (await leads.findAll({}, actor(salesA, 'SALES'))).map((r: any) => r.id);
      const theirs = (await leads.findAll({}, actor(salesB, 'SALES'))).map((r: any) => r.id);
      expect(mine).toContain(lead.id);
      expect(theirs).not.toContain(lead.id);
    });

    it('OWNER can still create a lead on someone else’s behalf', async () => {
      // Assigning work to a rep is a manager's job; this restriction is about
      // a rep putting work into someone else's queue, not about delegation.
      const contactId = await mkContact();
      const lead: any = await leads.create(
        { contactId, ownerId: salesA } as any,
        actor(owner, 'OWNER') as any,
      );
      made.leads.push(lead.id);
      expect(lead.ownerId).toBe(salesA);
    });

    it('a SECONDARY oversight role lets a SALES user assign on behalf', async () => {
      const contactId = await mkContact();
      const lead: any = await leads.create(
        { contactId, ownerId: salesB } as any,
        actor(salesA, 'SALES', ['ADMIN']) as any,
      );
      made.leads.push(lead.id);
      expect(lead.ownerId).toBe(salesB);
    });

    it('internal callers with no actor are unaffected', async () => {
      const contactId = await mkContact();
      const lead: any = await leads.create({ contactId, ownerId: salesB } as any);
      made.leads.push(lead.id);
      expect(lead.ownerId).toBe(salesB);
    });
  });

  describe('the role column has no default', () => {
    it('a user cannot be created without an explicit role', async () => {
      // It used to default to SALES. That was harmless only while SALES could
      // reach nothing; now the role is active, so a create that forgot to set
      // one would have quietly minted a working staff account.
      await expect(
        prisma.user.create({
          data: { name: 'No Role', email: `norole.${stamp()}@t.local`, passwordHash: 'x' } as any,
        }),
      ).rejects.toThrow();
    });

    it('existing rows kept the role they already had', async () => {
      // Dropping a column default rewrites nothing.
      const u = await prisma.user.findUnique({ where: { id: salesA } });
      expect(u!.role).toBe('SALES');
    });
  });

  describe('/staff/leads — the management surface', () => {
    // This list is the manager's view across everyone's queues, so oversight
    // roles stay unrestricted. CONSULTANT is not one: it is a working role
    // (Admission Officer) and was reading every lead here for the same reason
    // it could on /leads — a role gate mistaken for a scope.
    const staffActor = (id: string, role: string, secondaryRoles: string[] = []) =>
      ({ id, role, secondaryRoles, name: role } as any);

    it('CONSULTANT sees only their own leads, exactly like SALES', async () => {
      const res = await staffLeads.list({}, staffActor(consultant, 'CONSULTANT'));
      expect(res.leads.every((r: any) => r.assignedToId === consultant)).toBe(true);
      expect(res.leads.map((r: any) => r.id)).toContain(leadOfConsultant);
      expect(res.leads.map((r: any) => r.id)).not.toContain(leadOfA);
    });

    it('CONSULTANT cannot widen with assignedToId', async () => {
      const res = await staffLeads.list(
        { assignedToId: salesA },
        staffActor(consultant, 'CONSULTANT'),
      );
      expect(res.leads.every((r: any) => r.assignedToId === consultant)).toBe(true);
    });

    it('CONSULTANT cannot open another owner’s lead detail', async () => {
      await expect(staffLeads.detail(leadOfA, staffActor(consultant, 'CONSULTANT')))
        .rejects.toThrow(/not found/i);
      await expect(staffLeads.detail(leadOfConsultant, staffActor(consultant, 'CONSULTANT')))
        .resolves.toMatchObject({ id: leadOfConsultant });
    });

    it.each([['OWNER'], ['SUPER_ADMIN'], ['ADMIN'], ['FINANCE']])(
      '%s visibility is unchanged — still sees other owners’ leads',
      async (role) => {
        const id = role === 'FINANCE' ? finance : owner;
        const res = await staffLeads.list({}, staffActor(id, role));
        const ids = res.leads.map((r: any) => r.id);
        expect(ids).toEqual(expect.arrayContaining([leadOfA, leadOfConsultant]));
      },
    );

    it('OWNER can still open any lead detail', async () => {
      await expect(staffLeads.detail(leadOfA, staffActor(owner, 'OWNER')))
        .resolves.toMatchObject({ id: leadOfA });
    });

    it('a SECONDARY oversight role widens CONSULTANT here too', async () => {
      const res = await staffLeads.list({}, staffActor(consultant, 'CONSULTANT', ['ADMIN']));
      expect(res.leads.map((r: any) => r.id)).toEqual(expect.arrayContaining([leadOfA]));
    });

    it('no actor keeps the surface unscoped, for internal callers', async () => {
      const res = await staffLeads.list({});
      expect(res.leads.length).toBeGreaterThan(1);
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
