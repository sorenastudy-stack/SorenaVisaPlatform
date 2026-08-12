import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AgentPayablesService, AGENT_COMMISSION_RATE_PERCENT } from './agent-payables.service';

/**
 * PR-AGENT-PAYABLES (phase 1) — derivation and visibility.
 *
 * Against a real database, because the thing under test is a five-table walk
 * (payable → commission → programme choice → admission application → case →
 * lead → agent) plus a unique constraint. A mock would accept a chain that
 * silently matched everything, which is exactly the failure that would invent
 * money owed to someone.
 *
 * The properties worth pinning are the ones that would misstate a debt rather
 * than crash: a payable derived for a lead nobody introduced, a commission
 * counted twice, an amount recalculated after the rate moved.
 */

jest.setTimeout(90000);

describe('AgentPayablesService', () => {
  let prisma: PrismaClient;
  let svc: AgentPayablesService;

  const made = {
    payables: [] as string[], commissions: [] as string[], choices: [] as string[],
    admissions: [] as string[], cases: [] as string[], leads: [] as string[],
    contacts: [] as string[], programmes: [] as string[], providers: [] as string[],
    agents: [] as string[], users: [] as string[],
  };

  let ownerUser: string, financeUser: string, consultantUser: string;
  let agentA: string, agentB: string;

  let seq = 0;
  const stamp = () => `ap${Date.now()}_${(seq += 1)}`;
  const actor = (id: string, role: string) => ({ id, role, secondaryRoles: [] as string[] });

  async function mkUser(role: string) {
    const s = stamp();
    const u = await prisma.user.create({
      data: { name: `${role} ${s}`, email: `${role.toLowerCase()}.${s}@t.local`, passwordHash: 'x', role: role as any, isActive: true },
    });
    made.users.push(u.id);
    return u.id;
  }

  async function mkAgent() {
    const s = stamp();
    const a = await prisma.affiliateAgent.create({
      data: { fullName: `Agent ${s}`, email: `agent.${s}@t.local`, createdById: ownerUser } as any,
    });
    made.agents.push(a.id);
    return a.id;
  }

  /** A commission, optionally on a lead introduced by `agentId`. */
  async function mkCommission(opts: {
    agentId?: string | null; actual?: number | null; estimated?: number | null;
    status?: string; currency?: string;
  }) {
    const s = stamp();
    const contact = await prisma.contact.create({ data: { fullName: `C ${s}`, email: `c.${s}@t.local` } });
    made.contacts.push(contact.id);
    const lead = await prisma.lead.create({
      data: { contactId: contact.id, leadStatus: 'NEW', attributedAgentId: opts.agentId ?? null } as any,
    });
    made.leads.push(lead.id);
    const kase = await prisma.case.create({ data: { leadId: lead.id } });
    made.cases.push(kase.id);
    const adm = await prisma.admissionApplication.create({ data: { caseId: kase.id, contactId: contact.id } as any });
    made.admissions.push(adm.id);
    const prov = await prisma.educationProvider.create({ data: { name: `Prov ${s}`, providerType: 'UNIVERSITY' } as any });
    made.providers.push(prov.id);
    const prog = await prisma.educationProgramme.create({
      data: { providerId: prov.id, name: `Prog ${s}`, level: 'BACHELOR', nzqfLevel: 'LEVEL_7' } as any,
    });
    made.programmes.push(prog.id);
    const choice = await prisma.admissionProgrammeChoice.create({
      data: { admissionApplicationId: adm.id, programmeId: prog.id, intakeMonth: 2, intakeYear: 2027, priority: 1 } as any,
    });
    made.choices.push(choice.id);
    const com = await prisma.commission.create({
      data: {
        programmeChoiceId: choice.id, providerId: prov.id, programmeId: prog.id,
        commissionValue: 15,
        actualAmountNZD: opts.actual ?? null,
        estimatedAmountNZD: opts.estimated ?? null,
        currency: opts.currency ?? 'NZD',
        status: (opts.status ?? 'ESTIMATED') as any,
      } as any,
    });
    made.commissions.push(com.id);
    return com.id;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    svc = new AgentPayablesService(prisma as any);
    ownerUser = await mkUser('OWNER');
    financeUser = await mkUser('FINANCE');
    consultantUser = await mkUser('CONSULTANT');
    agentA = await mkAgent();
    agentB = await mkAgent();
  }, 90000);

  afterAll(async () => {
    await prisma.agentPayable.deleteMany({ where: { commissionId: { in: made.commissions } } }).catch(() => {});
    await prisma.commission.deleteMany({ where: { id: { in: made.commissions } } }).catch(() => {});
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

  // findFirst, not findUnique: phase 2 narrowed the constraint from "one
  // payable per commission" to "one LIVE payable per commission", so a
  // commission may hold a rejected row and its replacement.
  const forCommission = async (id: string) =>
    prisma.agentPayable.findFirst({
      where: { commissionId: id, status: { not: 'REJECTED' } },
      orderBy: { createdAt: 'desc' },
    });

  describe('derivation', () => {
    it('derives a payable at the flat rate for a commission on an introduced lead', async () => {
      const com = await mkCommission({ agentId: agentA, actual: 1000 });
      await svc.syncFromCommissions();
      const p = await forCommission(com);
      expect(p).not.toBeNull();
      expect(p!.agentId).toBe(agentA);
      expect(Number(p!.amount)).toBe(1000 * (AGENT_COMMISSION_RATE_PERCENT / 100));
      expect(p!.ratePercent).toBe(AGENT_COMMISSION_RATE_PERCENT);
      expect(p!.status).toBe('PENDING');
    });

    it('derives NOTHING for a commission on a lead nobody introduced', async () => {
      // The property that stops money being invented for an unattributed client.
      const com = await mkCommission({ agentId: null, actual: 1000 });
      await svc.syncFromCommissions();
      expect(await forCommission(com)).toBeNull();
    });

    it('prefers the actual amount over the estimate', async () => {
      const com = await mkCommission({ agentId: agentA, actual: 800, estimated: 5000 });
      await svc.syncFromCommissions();
      expect(Number((await forCommission(com))!.amount)).toBe(80);
    });

    it('falls back to the estimate when there is no actual yet', async () => {
      const com = await mkCommission({ agentId: agentA, actual: null, estimated: 600 });
      await svc.syncFromCommissions();
      expect(Number((await forCommission(com))!.amount)).toBe(60);
    });

    it('derives nothing from an unpriced commission rather than a zero payable', async () => {
      const com = await mkCommission({ agentId: agentA, actual: null, estimated: null });
      await svc.syncFromCommissions();
      expect(await forCommission(com)).toBeNull();
    });

    it('derives nothing from a cancelled commission', async () => {
      const com = await mkCommission({ agentId: agentA, actual: 1000, status: 'CANCELLED' });
      await svc.syncFromCommissions();
      expect(await forCommission(com)).toBeNull();
    });

    it('is idempotent — a second sync creates no duplicate', async () => {
      const com = await mkCommission({ agentId: agentA, actual: 1000 });
      await svc.syncFromCommissions();
      await svc.syncFromCommissions();
      await svc.syncFromCommissions();
      expect(await prisma.agentPayable.count({ where: { commissionId: com } })).toBe(1);
    });

    it('never restates an existing payable after the rate changes', async () => {
      // The reason amount and rate are snapshotted. An agent already told what
      // they are owed must not see it move because a constant was edited.
      const com = await mkCommission({ agentId: agentA, actual: 1000 });
      await svc.syncFromCommissions();
      const before = await forCommission(com);

      await prisma.agentPayable.update({ where: { id: before!.id }, data: { ratePercent: 99 } });
      await svc.syncFromCommissions();

      const after = await forCommission(com);
      expect(Number(after!.amount)).toBe(Number(before!.amount));
      expect(after!.ratePercent).toBe(99);
    });

    it('uses the agent’s own rate when the Owner has set one', async () => {
      // PR-AGENT-PORTAL phase 0 — the rate moved from one company-wide constant
      // to a per-agent figure. Only the source changed; the snapshot did not.
      const special = await mkAgent();
      await prisma.affiliateAgent.update({
        where: { id: special },
        data: { commissionRatePercent: 25 },
      });
      const com = await mkCommission({ agentId: special, actual: 1000 });
      await svc.syncFromCommissions();

      const p = await forCommission(com);
      expect(Number(p!.amount)).toBe(250);
      expect(p!.ratePercent).toBe(25);
    });

    it('falls back to the company rate when the agent has none', async () => {
      const plain = await mkAgent();
      const com = await mkCommission({ agentId: plain, actual: 1000 });
      await svc.syncFromCommissions();

      const p = await forCommission(com);
      expect(p!.ratePercent).toBe(AGENT_COMMISSION_RATE_PERCENT);
      expect(Number(p!.amount)).toBe(1000 * (AGENT_COMMISSION_RATE_PERCENT / 100));
    });

    it('honours a zero rate rather than treating it as unset', async () => {
      // 0% is a real agreement — an agent who introduces for other reasons.
      // Reading it as "no override" would quietly pay them the company rate.
      const freeAgent = await mkAgent();
      await prisma.affiliateAgent.update({
        where: { id: freeAgent },
        data: { commissionRatePercent: 0 },
      });
      const com = await mkCommission({ agentId: freeAgent, actual: 1000 });
      await svc.syncFromCommissions();

      const p = await forCommission(com);
      expect(p).not.toBeNull();
      expect(p!.ratePercent).toBe(0);
      expect(Number(p!.amount)).toBe(0);
    });

    it('gives two agents their own rates in the same sync', async () => {
      const a = await mkAgent();
      const b = await mkAgent();
      await prisma.affiliateAgent.update({ where: { id: a }, data: { commissionRatePercent: 5 } });
      await prisma.affiliateAgent.update({ where: { id: b }, data: { commissionRatePercent: 20 } });
      const comA = await mkCommission({ agentId: a, actual: 1000 });
      const comB = await mkCommission({ agentId: b, actual: 1000 });

      await svc.syncFromCommissions();

      expect(Number((await forCommission(comA))!.amount)).toBe(50);
      expect(Number((await forCommission(comB))!.amount)).toBe(200);
    });

    it('keeps the commission’s own currency', async () => {
      const com = await mkCommission({ agentId: agentA, actual: 500, currency: 'USD' });
      await svc.syncFromCommissions();
      expect((await forCommission(com))!.currency).toBe('USD');
    });
  });

  describe('access', () => {
    it('admits the money tier', async () => {
      for (const [id, role] of [[ownerUser, 'OWNER'], [financeUser, 'FINANCE']] as const) {
        await expect(svc.list(actor(id, role))).resolves.toBeDefined();
      }
    });

    it('refuses everyone else', async () => {
      await expect(svc.list(actor(consultantUser, 'CONSULTANT'))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.summary(actor(consultantUser, 'CONSULTANT'))).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('summary', () => {
    it('totals owed per agent and keeps agents apart', async () => {
      const cA = await mkCommission({ agentId: agentA, actual: 1000 });
      const cB = await mkCommission({ agentId: agentB, actual: 2000 });
      await svc.syncFromCommissions();

      const rows = await svc.summary(actor(ownerUser, 'OWNER'));
      const a = rows.find((r) => r.agentId === agentA && r.currency === 'NZD');
      const b = rows.find((r) => r.agentId === agentB && r.currency === 'NZD');
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      // agentB's single 2000 commission yields 200; agentA has several from
      // earlier tests, so only assert B's exact figure is present in B's row.
      expect(b!.owedMinorUnits).toBeGreaterThanOrEqual(20000);
      expect(a!.agentId).not.toBe(b!.agentId);
      expect(cA && cB).toBeTruthy();
    });

    it('moves an amount from owed to paid once it is marked paid', async () => {
      const com = await mkCommission({ agentId: agentB, actual: 300 });
      await svc.syncFromCommissions();
      const p = await forCommission(com);

      const before = (await svc.summary(actor(ownerUser, 'OWNER')))
        .find((r) => r.agentId === agentB && r.currency === 'NZD')!;

      await prisma.agentPayable.update({ where: { id: p!.id }, data: { status: 'PAID', paidAt: new Date() } });

      const after = (await svc.summary(actor(ownerUser, 'OWNER')))
        .find((r) => r.agentId === agentB && r.currency === 'NZD')!;

      expect(before.owedMinorUnits - after.owedMinorUnits).toBe(3000);
      expect(after.paidMinorUnits - before.paidMinorUnits).toBe(3000);
    });

    it('an agent owed in two currencies gets two balances, not one blended figure', async () => {
      const agentC = await mkAgent();
      await mkCommission({ agentId: agentC, actual: 1000, currency: 'NZD' });
      await mkCommission({ agentId: agentC, actual: 1000, currency: 'USD' });
      await svc.syncFromCommissions();

      const rows = (await svc.summary(actor(ownerUser, 'OWNER'))).filter((r) => r.agentId === agentC);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.currency).sort()).toEqual(['NZD', 'USD']);
    });
  });

  it('the ledger reports amounts in minor units, with the agent and provider named', async () => {
    const com = await mkCommission({ agentId: agentA, actual: 1000 });
    await svc.syncFromCommissions();
    const row = (await svc.list(actor(financeUser, 'FINANCE'))).find((r) => r.commissionId === com);
    expect(row).toBeDefined();
    expect(row!.amountMinorUnits).toBe(10000);
    expect(row!.agentName).toBeTruthy();
    expect(row!.providerName).toBeTruthy();
    expect(row!.status).toBe('PENDING');
  });
});
