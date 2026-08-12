import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AgentPayablesService } from './agent-payables.service';

/**
 * PR-AGENT-PAYABLES (phase 2) — approve, reject, release.
 *
 * Against a real database, because every property worth pinning here is a
 * property of the database rather than of the code: a partial unique index, a
 * conditional update under a race, an enum with a terminal state. A mock would
 * agree with whatever the code believed.
 *
 * The tests that matter are the ones that would let money out of the company
 * wrongly — one person completing both halves, the same payable released twice,
 * a refusal with no reason attached to it.
 */

jest.setTimeout(90000);

describe('AgentPayablesService — decisions', () => {
  let prisma: PrismaClient;
  let svc: AgentPayablesService;

  const made = {
    commissions: [] as string[], choices: [] as string[], admissions: [] as string[],
    cases: [] as string[], leads: [] as string[], contacts: [] as string[],
    programmes: [] as string[], providers: [] as string[], agents: [] as string[],
    users: [] as string[],
  };

  let financeA: string, financeB: string, ownerA: string, ownerB: string, consultant: string;
  let agent: string;

  let seq = 0;
  const stamp = () => `ap2${Date.now()}_${(seq += 1)}`;
  const actor = (id: string, role: string) => ({ id, role, secondaryRoles: [] as string[] });

  async function mkUser(role: string, name: string) {
    const s = stamp();
    const u = await prisma.user.create({
      data: { name, email: `${role.toLowerCase()}.${s}@t.local`, passwordHash: 'x', role: role as any, isActive: true },
    });
    made.users.push(u.id);
    return u.id;
  }

  /** A commission on a lead this agent introduced, and its derived payable. */
  async function mkPayable(amount = 1000) {
    const s = stamp();
    const contact = await prisma.contact.create({ data: { fullName: `C ${s}`, email: `c.${s}@t.local` } });
    made.contacts.push(contact.id);
    const lead = await prisma.lead.create({
      data: { contactId: contact.id, leadStatus: 'NEW', attributedAgentId: agent } as any,
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
        commissionValue: 15, actualAmountNZD: amount, currency: 'NZD', status: 'ESTIMATED',
      } as any,
    });
    made.commissions.push(com.id);

    await svc.syncFromCommissions();
    const payable = await prisma.agentPayable.findFirstOrThrow({
      where: { commissionId: com.id, status: { not: 'REJECTED' } },
    });
    return { commissionId: com.id, payableId: payable.id };
  }

  const audit = (entityId: string, eventType?: string) =>
    prisma.auditLog.findMany({
      where: { entityType: 'AGENT_PAYABLE', entityId, ...(eventType ? { eventType } : {}) },
    });

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    svc = new AgentPayablesService(prisma as any);
    financeA = await mkUser('FINANCE', 'Elisa Finance');
    financeB = await mkUser('FINANCE', 'Second Finance');
    ownerA = await mkUser('OWNER', 'Owner One');
    ownerB = await mkUser('OWNER', 'Owner Two');
    consultant = await mkUser('CONSULTANT', 'An Officer');
    const a = await prisma.affiliateAgent.create({
      data: { fullName: `Agent ${stamp()}`, email: `agent.${stamp()}@t.local`, createdById: ownerA } as any,
    });
    made.agents.push(a.id);
    agent = a.id;
  }, 90000);

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: 'AGENT_PAYABLE', userId: { in: made.users } } }).catch(() => {});
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

  describe('dual control', () => {
    it('REFUSES a release by the same person who approved it', async () => {
      // The rule this phase exists for. Everything else is bookkeeping.
      const { payableId } = await mkPayable();
      await svc.approve(payableId, actor(ownerA, 'OWNER'));

      await expect(svc.release(payableId, actor(ownerA, 'OWNER')))
        .rejects.toBeInstanceOf(ForbiddenException);

      const after = await prisma.agentPayable.findUniqueOrThrow({ where: { id: payableId } });
      expect(after.status).toBe('APPROVED');
      expect(after.paidAt).toBeNull();
      expect(after.paidById).toBeNull();
    });

    it('records the refused self-release rather than failing silently', async () => {
      const { payableId } = await mkPayable();
      await svc.approve(payableId, actor(ownerA, 'OWNER'));
      await svc.release(payableId, actor(ownerA, 'OWNER')).catch(() => undefined);

      const rows = await audit(payableId, 'AGENT_PAYABLE_RELEASE_REFUSED');
      expect(rows).toHaveLength(1);
      expect((rows[0].newValue as any).refusedBecause).toMatch(/same person/i);
    });

    it('allows a DIFFERENT owner to release what finance approved', async () => {
      const { payableId } = await mkPayable(2000);
      await svc.approve(payableId, actor(financeA, 'FINANCE'));
      const released = await svc.release(payableId, actor(ownerA, 'OWNER'));

      expect(released.status).toBe('PAID');
      expect(released.approvedById).toBe(financeA);
      expect(released.paidById).toBe(ownerA);
      expect(released.paidByName).toBe('Owner One');
    });

    it('refuses a release by anyone who is not the Owner', async () => {
      const { payableId } = await mkPayable();
      await svc.approve(payableId, actor(financeA, 'FINANCE'));
      await expect(svc.release(payableId, actor(financeB, 'FINANCE')))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses approval from outside the money tier', async () => {
      const { payableId } = await mkPayable();
      await expect(svc.approve(payableId, actor(consultant, 'CONSULTANT')))
        .rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.reject(payableId, 'no', actor(consultant, 'CONSULTANT')))
        .rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('concurrency', () => {
    it('releases once when two owners release the same payable at the same time', async () => {
      const { payableId } = await mkPayable(3000);
      await svc.approve(payableId, actor(financeA, 'FINANCE'));

      const results = await Promise.allSettled([
        svc.release(payableId, actor(ownerA, 'OWNER')),
        svc.release(payableId, actor(ownerB, 'OWNER')),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');

      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);

      const row = await prisma.agentPayable.findUniqueOrThrow({ where: { id: payableId } });
      expect(row.status).toBe('PAID');
      // Exactly one payment event — the money left once.
      expect(await audit(payableId, 'AGENT_PAYABLE_PAID')).toHaveLength(1);
    });

    it('approves once when two people approve at the same time', async () => {
      const { payableId } = await mkPayable();
      const results = await Promise.allSettled([
        svc.approve(payableId, actor(financeA, 'FINANCE')),
        svc.approve(payableId, actor(financeB, 'FINANCE')),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await audit(payableId, 'AGENT_PAYABLE_APPROVED')).toHaveLength(1);
    });
  });

  describe('rejection', () => {
    it('requires a reason', async () => {
      const { payableId } = await mkPayable();
      await expect(svc.reject(payableId, '   ', actor(financeA, 'FINANCE')))
        .rejects.toBeInstanceOf(BadRequestException);
      const row = await prisma.agentPayable.findUniqueOrThrow({ where: { id: payableId } });
      expect(row.status).toBe('PENDING');
    });

    it('keeps who refused it, when, and why', async () => {
      const { payableId } = await mkPayable();
      const out = await svc.reject(payableId, 'Provider clawed the commission back', actor(financeA, 'FINANCE'));
      expect(out.status).toBe('REJECTED');
      expect(out.rejectedById).toBe(financeA);
      expect(out.rejectedByName).toBe('Elisa Finance');
      expect(out.rejectedAt).toBeInstanceOf(Date);
      expect(out.rejectionReason).toBe('Provider clawed the commission back');
    });

    it('is terminal — a rejected payable cannot be approved or released', async () => {
      const { payableId } = await mkPayable();
      await svc.reject(payableId, 'not owed', actor(financeA, 'FINANCE'));
      await expect(svc.approve(payableId, actor(financeB, 'FINANCE'))).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.release(payableId, actor(ownerA, 'OWNER'))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does NOT resurrect itself on the next sync', async () => {
      // A refusal that undoes itself within a second is not a refusal. The
      // constraint permits a replacement; the derivation must not create one
      // unasked, or Finance rejects the same row forever.
      const { commissionId, payableId } = await mkPayable(700);
      await svc.reject(payableId, 'raised in error', actor(financeA, 'FINANCE'));

      await svc.syncFromCommissions();
      await svc.syncFromCommissions();

      const all = await prisma.agentPayable.findMany({ where: { commissionId } });
      expect(all).toHaveLength(1);
      expect(all[0].status).toBe('REJECTED');
      expect(all[0].rejectionReason).toBe('raised in error');
    });

    it('still ALLOWS a replacement to be raised deliberately', async () => {
      // Why the unique index is partial rather than outright: re-raising needs
      // no migration when somebody builds the action for it. Written directly
      // here because no service method offers it yet.
      const { commissionId, payableId } = await mkPayable(700);
      await svc.reject(payableId, 'wrong amount', actor(financeA, 'FINANCE'));

      const replacement = await prisma.agentPayable.create({
        data: { agentId: agent, commissionId, amount: 70 as any, currency: 'NZD', ratePercent: 10 },
      });
      expect(replacement.status).toBe('PENDING');

      const all = await prisma.agentPayable.findMany({ where: { commissionId }, orderBy: { createdAt: 'asc' } });
      expect(all).toHaveLength(2);
      // The refusal stays on record beside its replacement.
      expect(all[0].rejectionReason).toBe('wrong amount');
    });

    it('allows only ONE live payable per commission', async () => {
      const { commissionId } = await mkPayable();
      await expect(
        prisma.agentPayable.create({
          data: { agentId: agent, commissionId, amount: 1 as any, currency: 'NZD', ratePercent: 10 },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('keeps a rejected payable out of the owed balance', async () => {
      const { payableId } = await mkPayable(5000);
      const before = (await svc.summary(actor(ownerA, 'OWNER')))
        .find((r) => r.agentId === agent && r.currency === 'NZD')!;
      await svc.reject(payableId, 'duplicate', actor(financeA, 'FINANCE'));
      const after = (await svc.summary(actor(ownerA, 'OWNER')))
        .find((r) => r.agentId === agent && r.currency === 'NZD')!;

      // 5000 * 10% = 500 leaves the balance, and nothing silently replaces it.
      expect(before.owedMinorUnits - after.owedMinorUnits).toBe(50000);
      const rejected = await prisma.agentPayable.findUniqueOrThrow({ where: { id: payableId } });
      expect(rejected.status).toBe('REJECTED');
    });
  });

  describe('immutability across transitions', () => {
    it('never recomputes the amount or the rate when approving or releasing', async () => {
      const { payableId } = await mkPayable(1234);
      const before = await prisma.agentPayable.findUniqueOrThrow({ where: { id: payableId } });

      await svc.approve(payableId, actor(financeA, 'FINANCE'));
      await svc.release(payableId, actor(ownerA, 'OWNER'));

      const after = await prisma.agentPayable.findUniqueOrThrow({ where: { id: payableId } });
      expect(Number(after.amount)).toBe(Number(before.amount));
      expect(after.ratePercent).toBe(before.ratePercent);
      expect(after.currency).toBe(before.currency);
      expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
    });
  });

  describe('audit trail', () => {
    it('records the amount and currency with every money event', async () => {
      // The refund precedent records that something was executed but not what
      // moved. A payment event should be legible without a join.
      const { payableId } = await mkPayable(900);
      await svc.approve(payableId, actor(financeA, 'FINANCE'));
      await svc.release(payableId, actor(ownerA, 'OWNER'));

      const paid = (await audit(payableId, 'AGENT_PAYABLE_PAID'))[0];
      expect(paid).toBeDefined();
      expect((paid.newValue as any).amount).toBe(90);
      expect((paid.newValue as any).currency).toBe('NZD');
      expect(paid.actorNameSnapshot).toBe('Owner One');
      expect(paid.actorRoleSnapshot).toBe('OWNER');
      expect((paid.newValue as any).approvedById).toBe(financeA);
    });

    it('snapshots the deciding actor name even though the JWT carries none', async () => {
      const { payableId } = await mkPayable();
      // No `name` on the actor — exactly what the controller passes.
      const out = await svc.approve(payableId, { id: financeA, role: 'FINANCE', secondaryRoles: [] });
      expect(out.approvedByName).toBe('Elisa Finance');
    });

    it('records a refused release caused by the wrong state', async () => {
      const { payableId } = await mkPayable();
      await svc.release(payableId, actor(ownerA, 'OWNER')).catch(() => undefined);
      const rows = await audit(payableId, 'AGENT_PAYABLE_RELEASE_REFUSED');
      expect(rows).toHaveLength(1);
      expect((rows[0].newValue as any).refusedBecause).toMatch(/not APPROVED/);
    });
  });

  describe('queues', () => {
    it('lists pending for finance and awaiting-release for the owner, and counts the badge', async () => {
      const { payableId } = await mkPayable(4000);
      const pending = await svc.listPending(actor(financeA, 'FINANCE'));
      expect(pending.some((r) => r.id === payableId)).toBe(true);

      await svc.approve(payableId, actor(financeA, 'FINANCE'));

      const awaiting = await svc.listAwaitingRelease(actor(ownerA, 'OWNER'));
      const mine = awaiting.find((r) => r.id === payableId);
      expect(mine).toBeDefined();
      expect(mine!.approvedByName).toBe('Elisa Finance');
      expect(mine!.amountMinorUnits).toBe(40000);

      const { count } = await svc.awaitingReleaseCount(actor(ownerA, 'OWNER'));
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('refuses the pending queue to a consultant', async () => {
      await expect(svc.listPending(actor(consultant, 'CONSULTANT')))
        .rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
