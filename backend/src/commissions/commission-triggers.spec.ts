import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CommissionsService } from './commissions.service';
import { CommissionTriggersService, ELIGIBILITY_DAYS } from './commission-triggers.service';

/**
 * PR-COMMISSION-TRIGGER — claim, decide, and the fortnight in between.
 *
 * Against a real database: eligibility is a Prisma `where` over a date and the
 * absence of related rows, and a mock would happily accept a predicate that
 * selects everything. The 13-vs-14-day boundary in particular is only worth
 * asserting against the query that will actually run.
 */

jest.setTimeout(90000);

const DAY = 86_400_000;

describe('commission triggers', () => {
  let prisma: PrismaClient;
  let triggers: CommissionTriggersService;

  const made = {
    triggers: [] as string[], commissions: [] as string[], choices: [] as string[],
    admissions: [] as string[], cases: [] as string[], leads: [] as string[],
    contacts: [] as string[], programmes: [] as string[], providers: [] as string[],
    users: [] as string[],
  };

  let consultantA: string, consultantB: string, financeUser: string, ownerUser: string;
  let seq = 0;
  const stamp = () => `ct${Date.now()}_${(seq += 1)}`;

  const actor = (id: string, role: string) => ({ id, role, secondaryRoles: [] as string[] });

  async function mkUser(role: string) {
    const s = stamp();
    const u = await prisma.user.create({
      data: { name: `${role} ${s}`, email: `${role.toLowerCase()}.${s}@t.local`, passwordHash: 'x', role: role as any, isActive: true },
    });
    made.users.push(u.id);
    return u.id;
  }

  /** A full chain, with attendance set `attendedDaysAgo` in the past (null = none). */
  async function mkChain(ownerId: string | null, attendedDaysAgo: number | null) {
    const s = stamp();
    const contact = await prisma.contact.create({ data: { fullName: `Client ${s}`, email: `c.${s}@t.local` } });
    made.contacts.push(contact.id);
    const lead = await prisma.lead.create({ data: { contactId: contact.id, leadStatus: 'NEW', ownerId } as any });
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
      data: {
        admissionApplicationId: adm.id, programmeId: prog.id, intakeMonth: 2, intakeYear: 2027, priority: 1,
        ...(attendedDaysAgo === null ? {} : { firstClassAttendedAt: new Date(Date.now() - attendedDaysAgo * DAY) }),
      } as any,
    });
    made.choices.push(choice.id);
    return { caseId: kase.id, choiceId: choice.id, providerId: prov.id, programmeId: prog.id };
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    const events: any = { emit: jest.fn().mockResolvedValue(undefined) };
    const commissions = new CommissionsService(prisma as any, events);
    triggers = new CommissionTriggersService(prisma as any, commissions);

    consultantA = await mkUser('CONSULTANT');
    consultantB = await mkUser('CONSULTANT');
    financeUser = await mkUser('FINANCE');
    ownerUser = await mkUser('OWNER');
  }, 90000);

  afterAll(async () => {
    await prisma.commissionTrigger.deleteMany({ where: { programmeChoiceId: { in: made.choices } } }).catch(() => {});
    await prisma.commission.deleteMany({ where: { programmeChoiceId: { in: made.choices } } }).catch(() => {});
    await prisma.admissionProgrammeChoice.deleteMany({ where: { id: { in: made.choices } } }).catch(() => {});
    await prisma.admissionApplication.deleteMany({ where: { id: { in: made.admissions } } }).catch(() => {});
    await prisma.case.deleteMany({ where: { id: { in: made.cases } } }).catch(() => {});
    await prisma.lead.deleteMany({ where: { id: { in: made.leads } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { id: { in: made.contacts } } }).catch(() => {});
    await prisma.educationProgramme.deleteMany({ where: { id: { in: made.programmes } } }).catch(() => {});
    await prisma.educationProvider.deleteMany({ where: { id: { in: made.providers } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => {});
    await prisma.$disconnect();
  });

  describe('the 14-day boundary', () => {
    it(`does NOT surface a choice ${ELIGIBILITY_DAYS - 1} days after the first class`, async () => {
      const c = await mkChain(consultantA, ELIGIBILITY_DAYS - 1);
      const ids = (await triggers.listEligible(actor(consultantA, 'CONSULTANT'))).map((r) => r.programmeChoiceId);
      expect(ids).not.toContain(c.choiceId);
    });

    it(`DOES surface it ${ELIGIBILITY_DAYS} days after`, async () => {
      const c = await mkChain(consultantA, ELIGIBILITY_DAYS);
      const ids = (await triggers.listEligible(actor(consultantA, 'CONSULTANT'))).map((r) => r.programmeChoiceId);
      expect(ids).toContain(c.choiceId);
    });

    it('does not surface a choice with no attendance recorded at all', async () => {
      const c = await mkChain(consultantA, null);
      const ids = (await triggers.listEligible(actor(consultantA, 'CONSULTANT'))).map((r) => r.programmeChoiceId);
      expect(ids).not.toContain(c.choiceId);
    });
  });

  describe('ownership scoping', () => {
    it('a consultant sees only their own eligible cases', async () => {
      const mine = await mkChain(consultantA, 20);
      const theirs = await mkChain(consultantB, 20);
      const ids = (await triggers.listEligible(actor(consultantA, 'CONSULTANT'))).map((r) => r.programmeChoiceId);
      expect(ids).toContain(mine.choiceId);
      expect(ids).not.toContain(theirs.choiceId);
    });

    it('cannot submit a claim on someone else’s case', async () => {
      const theirs = await mkChain(consultantB, 20);
      await expect(triggers.submit(theirs.choiceId, actor(consultantA, 'CONSULTANT')))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('oversight roles see every eligible case', async () => {
      const a = await mkChain(consultantA, 20);
      const b = await mkChain(consultantB, 20);
      const ids = (await triggers.listEligible(actor(ownerUser, 'OWNER'))).map((r) => r.programmeChoiceId);
      expect(ids).toEqual(expect.arrayContaining([a.choiceId, b.choiceId]));
    });

    it('FINANCE cannot submit, a consultant cannot decide', async () => {
      const c = await mkChain(consultantA, 20);
      await expect(triggers.submit(c.choiceId, actor(financeUser, 'FINANCE')))
        .rejects.toBeInstanceOf(ForbiddenException);
      await expect(triggers.listPending(actor(consultantA, 'CONSULTANT')))
        .rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('confirming attendance', () => {
    it('records the date and makes the choice eligible once the fortnight passes', async () => {
      const c = await mkChain(consultantA, null);
      const past = new Date(Date.now() - 30 * DAY);
      const r = await triggers.confirmFirstClassAttended(c.caseId, c.choiceId, past, actor(consultantA, 'CONSULTANT'));
      expect(r.firstClassAttendedAt?.toISOString()).toBe(past.toISOString());
      const ids = (await triggers.listEligible(actor(consultantA, 'CONSULTANT'))).map((x) => x.programmeChoiceId);
      expect(ids).toContain(c.choiceId);
    });

    it('refuses a second confirmation rather than restarting the clock', async () => {
      const c = await mkChain(consultantA, 20);
      await expect(triggers.confirmFirstClassAttended(c.caseId, c.choiceId, null, actor(consultantA, 'CONSULTANT')))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a future date', async () => {
      const c = await mkChain(consultantA, null);
      await expect(
        triggers.confirmFirstClassAttended(c.caseId, c.choiceId, new Date(Date.now() + 5 * DAY), actor(consultantA, 'CONSULTANT')),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a choice that is not on the named case', async () => {
      const a = await mkChain(consultantA, null);
      const b = await mkChain(consultantA, null);
      await expect(triggers.confirmFirstClassAttended(a.caseId, b.choiceId, null, actor(consultantA, 'CONSULTANT')))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('submit → approve', () => {
    it('submitting removes it from the eligible queue and puts it in the pending one', async () => {
      const c = await mkChain(consultantA, 20);
      const t = await triggers.submit(c.choiceId, actor(consultantA, 'CONSULTANT'));
      made.triggers.push(t.id);
      expect(t.status).toBe('PENDING');

      const eligible = (await triggers.listEligible(actor(consultantA, 'CONSULTANT'))).map((r) => r.programmeChoiceId);
      expect(eligible).not.toContain(c.choiceId);

      const pending = await triggers.listPending(actor(financeUser, 'FINANCE'));
      const row = pending.find((r) => r.id === t.id);
      expect(row).toBeDefined();
      // The queue carries what a decision needs, without a second round-trip.
      expect(row!.studentName).toBeTruthy();
      expect(row!.programmeName).toBeTruthy();
      expect(row!.providerName).toBeTruthy();
      expect(row!.submittedByName).toBeTruthy();
    });

    it('a second submission on the same choice is refused', async () => {
      const c = await mkChain(consultantA, 20);
      const t = await triggers.submit(c.choiceId, actor(consultantA, 'CONSULTANT'));
      made.triggers.push(t.id);
      await expect(triggers.submit(c.choiceId, actor(consultantA, 'CONSULTANT')))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('cannot submit before the fortnight is up', async () => {
      const c = await mkChain(consultantA, 3);
      await expect(triggers.submit(c.choiceId, actor(consultantA, 'CONSULTANT')))
        .rejects.toThrow(/14 days after the first class/);
    });

    it('approval creates the commission at ESTIMATED, with the provider read from the programme', async () => {
      const c = await mkChain(consultantA, 20);
      const t = await triggers.submit(c.choiceId, actor(consultantA, 'CONSULTANT'));
      made.triggers.push(t.id);

      const { trigger, commission } = await triggers.approve(
        t.id, { commissionType: 'PERCENTAGE', commissionValue: 15, estimatedAmountNZD: 3000 }, actor(financeUser, 'FINANCE'),
      );
      made.commissions.push(commission.id);

      expect(trigger.status).toBe('APPROVED');
      expect(trigger.decidedById).toBe(financeUser);
      expect(trigger.decidedAt).toBeTruthy();

      // Identical to what the ledger's Record action would have produced.
      expect(commission.status).toBe('ESTIMATED');
      expect(commission.programmeChoiceId).toBe(c.choiceId);
      expect(commission.providerId).toBe(c.providerId);
      expect(commission.programmeId).toBe(c.programmeId);
      expect(commission.commissionValue).toBe(15);

      // And it leaves the pending queue.
      const pending = (await triggers.listPending(actor(financeUser, 'FINANCE'))).map((r) => r.id);
      expect(pending).not.toContain(t.id);
    });

    it('a decided trigger cannot be decided again', async () => {
      const c = await mkChain(consultantA, 20);
      const t = await triggers.submit(c.choiceId, actor(consultantA, 'CONSULTANT'));
      made.triggers.push(t.id);
      const { commission } = await triggers.approve(t.id, { commissionValue: 10 }, actor(financeUser, 'FINANCE'));
      made.commissions.push(commission.id);
      await expect(triggers.approve(t.id, { commissionValue: 10 }, actor(financeUser, 'FINANCE')))
        .rejects.toBeInstanceOf(BadRequestException);
      await expect(triggers.reject(t.id, 'nope', actor(financeUser, 'FINANCE')))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('reject → resubmit', () => {
    it('requires a reason', async () => {
      const c = await mkChain(consultantA, 20);
      const t = await triggers.submit(c.choiceId, actor(consultantA, 'CONSULTANT'));
      made.triggers.push(t.id);
      for (const bad of ['', '   ']) {
        await expect(triggers.reject(t.id, bad, actor(financeUser, 'FINANCE')))
          .rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('stores the reason and creates no commission', async () => {
      const c = await mkChain(consultantA, 20);
      const t = await triggers.submit(c.choiceId, actor(consultantA, 'CONSULTANT'));
      made.triggers.push(t.id);
      const r = await triggers.reject(t.id, 'Student withdrew in week one.', actor(financeUser, 'FINANCE'));
      expect(r.status).toBe('REJECTED');
      expect(r.rejectionReason).toBe('Student withdrew in week one.');
      expect(r.decidedById).toBe(financeUser);
      expect(await prisma.commission.count({ where: { programmeChoiceId: c.choiceId } })).toBe(0);
    });

    it('a rejected claim can be submitted again — the refusal is not permanent', async () => {
      // The reason the unique constraint is partial rather than plain. A flat
      // UNIQUE on programmeChoiceId would leave the rejected row in place and
      // strand that commission forever.
      const c = await mkChain(consultantA, 20);
      const first = await triggers.submit(c.choiceId, actor(consultantA, 'CONSULTANT'));
      made.triggers.push(first.id);
      await triggers.reject(first.id, 'Attendance not evidenced.', actor(financeUser, 'FINANCE'));

      const again = await triggers.submit(c.choiceId, actor(consultantA, 'CONSULTANT'));
      made.triggers.push(again.id);
      expect(again.status).toBe('PENDING');
      expect(again.id).not.toBe(first.id);

      // Both are on record — the rejection is history, not an erasure.
      const all = await prisma.commissionTrigger.findMany({ where: { programmeChoiceId: c.choiceId } });
      expect(all).toHaveLength(2);
      expect(all.filter((t) => t.status === 'REJECTED')).toHaveLength(1);
    });

    it('the eligible queue shows why the previous claim was refused', async () => {
      const c = await mkChain(consultantA, 20);
      const t = await triggers.submit(c.choiceId, actor(consultantA, 'CONSULTANT'));
      made.triggers.push(t.id);
      await triggers.reject(t.id, 'Wrong programme on the claim.', actor(financeUser, 'FINANCE'));

      const row = (await triggers.listEligible(actor(consultantA, 'CONSULTANT')))
        .find((r) => r.programmeChoiceId === c.choiceId);
      expect(row).toBeDefined();
      expect(row!.previouslyRejected?.reason).toBe('Wrong programme on the claim.');
    });
  });

  it('a choice that already has a commission never surfaces again', async () => {
    const c = await mkChain(consultantA, 20);
    const t = await triggers.submit(c.choiceId, actor(consultantA, 'CONSULTANT'));
    made.triggers.push(t.id);
    const { commission } = await triggers.approve(t.id, { commissionValue: 12 }, actor(financeUser, 'FINANCE'));
    made.commissions.push(commission.id);

    const ids = (await triggers.listEligible(actor(consultantA, 'CONSULTANT'))).map((r) => r.programmeChoiceId);
    expect(ids).not.toContain(c.choiceId);
    await expect(triggers.submit(c.choiceId, actor(consultantA, 'CONSULTANT')))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
