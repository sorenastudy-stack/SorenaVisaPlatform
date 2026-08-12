import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { resolveAgentAccess } from './agent-access.helper';
import { AgentAccessGuard } from './agent-access.guard';
import { AgentsService } from './agents.service';

/**
 * PR-AGENT-PORTAL phase 1 — the gate, and whose data is behind it.
 *
 * Against a real database: the gate is a query against one row, and the
 * ownership filter is a five-table walk. A mock would agree with whatever the
 * code believed about both.
 *
 * The two properties worth pinning are the ones that cannot be walked back
 * once wrong — an unverified agent seeing anything at all, and one agent
 * seeing another agent's clients.
 */

jest.setTimeout(90000);

describe('Agent portal access', () => {
  let prisma: PrismaClient;
  let svc: AgentsService;
  let guard: AgentAccessGuard;

  const made = {
    payables: [] as string[], commissions: [] as string[], choices: [] as string[],
    admissions: [] as string[], cases: [] as string[], leads: [] as string[],
    contacts: [] as string[], programmes: [] as string[], providers: [] as string[],
    agents: [] as string[], users: [] as string[],
  };

  let ownerUser: string;
  let seq = 0;
  const stamp = () => `ag${Date.now()}_${(seq += 1)}`;

  async function mkUser(role: string) {
    const s = stamp();
    const u = await prisma.user.create({
      data: { name: `${role} ${s}`, email: `${role.toLowerCase()}.${s}@t.local`, passwordHash: 'x', role: role as any, isActive: true },
    });
    made.users.push(u.id);
    return u.id;
  }

  /** An agent, with a login, at whatever point of the gate is wanted. */
  async function mkAgent(opts: { verified?: boolean; contracted?: boolean; status?: string; withLogin?: boolean } = {}) {
    const s = stamp();
    const userId = opts.withLogin === false ? null : await mkUser('AGENT');
    const a = await prisma.affiliateAgent.create({
      data: {
        fullName: `Agent ${s}`,
        email: `agent.${s}@t.local`,
        createdById: ownerUser,
        userId,
        status: (opts.status ?? 'ACTIVE') as any,
        verifiedAt: opts.verified ? new Date() : null,
        verifiedById: opts.verified ? ownerUser : null,
        contractSignedAt: opts.contracted ? new Date() : null,
        contractIsManualOverride: !!opts.contracted,
      },
    });
    made.agents.push(a.id);
    return { agentId: a.id, userId };
  }

  /** A client introduced by this agent, optionally with an offer and a payable. */
  async function mkIntroducedClient(agentId: string, opts: { offer?: boolean; started?: boolean; payable?: number } = {}) {
    const s = stamp();
    const contact = await prisma.contact.create({ data: { fullName: `Student ${s}`, email: `s.${s}@t.local` } });
    made.contacts.push(contact.id);
    const lead = await prisma.lead.create({
      data: { contactId: contact.id, leadStatus: 'NEW', attributedAgentId: agentId },
    });
    made.leads.push(lead.id);
    const kase = await prisma.case.create({ data: { leadId: lead.id } });
    made.cases.push(kase.id);
    const adm = await prisma.admissionApplication.create({ data: { caseId: kase.id, contactId: contact.id } });
    made.admissions.push(adm.id);
    const prov = await prisma.educationProvider.create({ data: { name: `Prov ${s}`, providerType: 'UNIVERSITY' } });
    made.providers.push(prov.id);
    const prog = await prisma.educationProgramme.create({
      data: { providerId: prov.id, name: `Prog ${s}`, level: 'BACHELOR', nzqfLevel: 'LEVEL_7' },
    });
    made.programmes.push(prog.id);
    const choice = await prisma.admissionProgrammeChoice.create({
      data: {
        admissionApplicationId: adm.id, programmeId: prog.id, intakeMonth: 2, intakeYear: 2027, priority: 1,
        firstClassAttendedAt: opts.started ? new Date() : null,
      },
    });
    made.choices.push(choice.id);
    if (opts.offer) {
      await prisma.offerRecord.create({
        data: {
          caseId: kase.id, admissionProgrammeChoiceId: choice.id,
          offerType: 'UNCONDITIONAL' as any, decision: 'ACCEPTED',
        },
      });
    }
    if (opts.payable != null) {
      const com = await prisma.commission.create({
        data: {
          programmeChoiceId: choice.id, providerId: prov.id, programmeId: prog.id,
          commissionValue: 15, actualAmountNZD: opts.payable, currency: 'NZD', status: 'INVOICED',
        },
      });
      made.commissions.push(com.id);
      const pay = await prisma.agentPayable.create({
        data: {
          agentId, commissionId: com.id,
          amount: (opts.payable * 0.1) as any, currency: 'NZD', ratePercent: 10,
        },
      });
      made.payables.push(pay.id);
    }
    return { leadId: lead.id, studentName: contact.fullName };
  }

  const ctx = (userId: string | null) => {
    const req: any = { user: userId ? { userId, role: 'AGENT' } : undefined };
    return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any };
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    svc = new AgentsService(prisma as any);
    guard = new AgentAccessGuard(prisma as any);
    ownerUser = await mkUser('OWNER');
  }, 90000);

  afterAll(async () => {
    await prisma.agentPayable.deleteMany({ where: { id: { in: made.payables } } }).catch(() => {});
    await prisma.commission.deleteMany({ where: { id: { in: made.commissions } } }).catch(() => {});
    await prisma.offerRecord.deleteMany({ where: { admissionProgrammeChoiceId: { in: made.choices } } }).catch(() => {});
    await prisma.admissionProgrammeChoice.deleteMany({ where: { id: { in: made.choices } } }).catch(() => {});
    await prisma.admissionApplication.deleteMany({ where: { id: { in: made.admissions } } }).catch(() => {});
    await prisma.case.deleteMany({ where: { id: { in: made.cases } } }).catch(() => {});
    await prisma.lead.deleteMany({ where: { id: { in: made.leads } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { id: { in: made.contacts } } }).catch(() => {});
    await prisma.educationProgramme.deleteMany({ where: { id: { in: made.programmes } } }).catch(() => {});
    await prisma.educationProvider.deleteMany({ where: { id: { in: made.providers } } }).catch(() => {});
    await prisma.affiliateAgent.deleteMany({ where: { id: { in: made.agents } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => {});
    await prisma.$disconnect();
  });

  describe('the gate — both halves, or nothing', () => {
    it.each([
      { state: 'neither verified nor contracted', verified: false, contracted: false, allowed: false },
      { state: 'verified but not contracted', verified: true, contracted: false, allowed: false },
      { state: 'contracted but not verified', verified: false, contracted: true, allowed: false },
      { state: 'verified and contracted', verified: true, contracted: true, allowed: true },
    ])('$state → allowed=$allowed', async ({ verified, contracted, allowed }) => {
      const { userId } = await mkAgent({ verified, contracted });
      const access = await resolveAgentAccess(prisma as any, userId);
      expect(access.allowed).toBe(allowed);
    });

    it('names what is outstanding, so the agent can act on it', async () => {
      const { userId } = await mkAgent({ verified: true, contracted: false });
      const access = await resolveAgentAccess(prisma as any, userId);
      expect(access.blockedReasons).toEqual(['NO_CONTRACT']);
    });

    it('blocks a paused agent even when both halves are satisfied', async () => {
      // Pausing has to override everything, or an agent who was fully
      // onboarded before being paused keeps working through the pause.
      const { userId } = await mkAgent({ verified: true, contracted: true, status: 'PAUSED' });
      const access = await resolveAgentAccess(prisma as any, userId);
      expect(access.allowed).toBe(false);
      expect(access.blockedReasons).toContain('AGENT_INACTIVE');
    });

    it('fails closed for a login with no agent record at all', async () => {
      const stray = await mkUser('AGENT');
      const access = await resolveAgentAccess(prisma as any, stray);
      expect(access.allowed).toBe(false);
      expect(access.agentId).toBeNull();
    });

    it('fails closed for no user id', async () => {
      expect((await resolveAgentAccess(prisma as any, null)).allowed).toBe(false);
      expect((await resolveAgentAccess(prisma as any, undefined)).allowed).toBe(false);
    });
  });

  describe('the guard', () => {
    it('refuses a blocked agent', async () => {
      const { userId } = await mkAgent({ verified: true, contracted: false });
      await expect(guard.canActivate(ctx(userId).ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not say WHICH half is missing in the error', async () => {
      // The detail belongs to /agent/me. An error string is the wrong place to
      // enumerate what a caller has not satisfied.
      const { userId } = await mkAgent({ verified: false, contracted: false });
      await expect(guard.canActivate(ctx(userId).ctx)).rejects.toThrow(/not active yet/i);
      await guard.canActivate(ctx(userId).ctx).catch((e) => {
        expect(e.message).not.toMatch(/verif|contract/i);
      });
    });

    it('admits a fully onboarded agent and hands on the resolved agent', async () => {
      const { agentId, userId } = await mkAgent({ verified: true, contracted: true });
      const c = ctx(userId);
      await expect(guard.canActivate(c.ctx)).resolves.toBe(true);
      // The service reads this rather than resolving the agent a second time.
      expect(c.req.agentAccess.agentId).toBe(agentId);
    });
  });

  describe('ownership — the failure that must never happen', () => {
    it('shows an agent only the clients they introduced', async () => {
      const a = await mkAgent({ verified: true, contracted: true });
      const b = await mkAgent({ verified: true, contracted: true });
      const mine = await mkIntroducedClient(a.agentId, { offer: true, started: true });
      await mkIntroducedClient(b.agentId, { offer: true });

      const leads = await svc.leads(a.agentId);
      expect(leads).toHaveLength(1);
      expect(leads[0].studentName).toBe(mine.studentName);
      expect(leads[0].hasOffer).toBe(true);
      expect(leads[0].startedClasses).toBe(true);
    });

    it('shows an agent only their own payables, and totals only their own', async () => {
      const a = await mkAgent({ verified: true, contracted: true });
      const b = await mkAgent({ verified: true, contracted: true });
      await mkIntroducedClient(a.agentId, { payable: 5000 });
      await mkIntroducedClient(b.agentId, { payable: 9000 });

      const out = await svc.payables(a.agentId);
      expect(out.items).toHaveLength(1);
      expect(out.items[0].amountMinorUnits).toBe(50000);
      expect(out.totals.owedByCurrency).toEqual({ NZD: 50000 });
      // B's 900 must appear nowhere.
      expect(JSON.stringify(out)).not.toContain('90000');
    });

    it('keeps a rejected payable visible but out of the total', async () => {
      const a = await mkAgent({ verified: true, contracted: true });
      await mkIntroducedClient(a.agentId, { payable: 3000 });
      const rows = await prisma.agentPayable.findMany({ where: { agentId: a.agentId } });
      await prisma.agentPayable.update({
        where: { id: rows[0].id },
        data: { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: 'clawed back' },
      });

      const out = await svc.payables(a.agentId);
      expect(out.items[0].status).toBe('REJECTED');
      expect(out.items[0].rejectionReason).toBe('clawed back');
      expect(out.totals.owedByCurrency).toEqual({});
    });

    it('separates owed from paid, per currency', async () => {
      const a = await mkAgent({ verified: true, contracted: true });
      await mkIntroducedClient(a.agentId, { payable: 1000 });
      await mkIntroducedClient(a.agentId, { payable: 2000 });
      const rows = await prisma.agentPayable.findMany({ where: { agentId: a.agentId }, orderBy: { amount: 'asc' } });
      await prisma.agentPayable.update({ where: { id: rows[0].id }, data: { status: 'PAID', paidAt: new Date() } });

      const out = await svc.payables(a.agentId);
      expect(out.totals.paidByCurrency).toEqual({ NZD: 10000 });
      expect(out.totals.owedByCurrency).toEqual({ NZD: 20000 });
    });
  });

  describe('/agent/me — what a blocked agent may learn', () => {
    it('tells them their own status without any client data', async () => {
      const a = await mkAgent({ verified: false, contracted: false });
      await mkIntroducedClient(a.agentId, { payable: 4000 });

      const me = await svc.me(a.userId!);
      expect(me.allowed).toBe(false);
      expect(me.blockedReasons.sort()).toEqual(['NOT_VERIFIED', 'NO_CONTRACT']);
      // Nothing about the business waiting behind the gate — not even a count.
      const body = JSON.stringify(me);
      expect(body).not.toMatch(/Student /);
      expect(body).not.toContain('40000');
      expect(Object.keys(me).sort()).toEqual(
        ['allowed', 'blockedReasons', 'contractIsManualOverride', 'contracted', 'name', 'verified'],
      );
    });

    it('reports a manually cleared contract as an override', async () => {
      const a = await mkAgent({ verified: true, contracted: true });
      const me = await svc.me(a.userId!);
      expect(me.contracted).toBe(true);
      expect(me.contractIsManualOverride).toBe(true);
    });
  });
});
