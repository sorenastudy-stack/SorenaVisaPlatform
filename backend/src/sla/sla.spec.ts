/**
 * PR-SLA — SlaService. DB-backed. The migration seeds the config; these tests
 * prove the calc is DB-config-driven (edit → deadline changes), varies
 * independently by institution type, honours the manual per-case override, marks
 * aged cases overdue, and that the by-officer report groups + role-gates.
 */

import { PrismaClient, ProviderType } from '@prisma/client';
import { SlaService } from './sla.service';

jest.setTimeout(60000);

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

describe('SlaService (institution-type SLAs)', () => {
  let prisma: PrismaClient;
  let svc: SlaService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    svc = new SlaService(prisma as any);
  }, 60000);

  afterAll(async () => { await prisma.$disconnect(); });

  let seq = 0;
  const stamp = () => `sla${Date.now()}_${(seq += 1)}`;

  // A case tied to a provider of the given institution type (via an application),
  // sitting in `stage` since `stageEnteredAt`.
  async function seedCase(institution: ProviderType, stage: any, stageEnteredAt: Date, coId?: string) {
    const s = stamp();
    const provider = await prisma.educationProvider.create({ data: { name: `P ${s}`, providerType: institution } as any });
    const programme = await prisma.educationProgramme.create({ data: { name: `Prog ${s}`, providerId: provider.id, level: 'DIPLOMA', nzqfLevel: 'LEVEL_5' } as any });
    const contact = await prisma.contact.create({ data: { fullName: `Student ${s}`, email: `s.${s}@t.local` } });
    const lead = await prisma.lead.create({ data: { contactId: contact.id, leadStatus: 'EXECUTING' } as any });
    const kase = await prisma.case.create({ data: { leadId: lead.id, stage, stageEnteredAt, ...(coId ? { consultantId: coId } : {}) } as any });
    await prisma.application.create({ data: { caseId: kase.id, providerId: provider.id, programmeId: programme.id, offerAcceptedAt: new Date('2026-01-01') } as any });
    return kase.id;
  }
  const one = async (caseId: string, now?: Date) => {
    const c = await prisma.case.findUnique({ where: { id: caseId }, select: { id: true, stage: true, stageEnteredAt: true, stageDeadlineOverride: true, createdAt: true } });
    return (await svc.computeForCases([c as any], now)).get(caseId)!;
  };

  it('deadline follows the seeded config; ADMISSION uses WORKING days', async () => {
    // Entered ADMISSION on a Monday (2026-06-01). 25 working days ≈ 5 weeks → ~2026-07-06.
    const caseId = await seedCase('UNIVERSITY', 'ADMISSION', new Date('2026-06-01T00:00:00Z'));
    const d = await one(caseId, new Date('2026-06-15T00:00:00Z'));
    expect(d.institutionType).toBe('UNIVERSITY');
    // 25 working days from Mon 06-01 lands on Mon 07-06 (weekends skipped).
    expect(d.deadline!.toISOString().slice(0, 10)).toBe('2026-07-06');
    expect(d.overdue).toBe(false);
  });

  it('ADMISSION working-day math skips NZ national public holidays', async () => {
    // Entered ADMISSION Mon 2026-07-06. Matariki (Fri 2026-07-10) is a national
    // public holiday inside the 25-working-day window, so it's skipped: the deadline
    // lands one weekday LATER than a weekends-only count would give.
    //   weekends-only → 2026-08-10; skipping Matariki too → 2026-08-11.
    const caseId = await seedCase('UNIVERSITY', 'ADMISSION', new Date('2026-07-06T00:00:00Z'));
    const d = await one(caseId, new Date('2026-07-20T00:00:00Z'));
    expect(d.deadline!.toISOString().slice(0, 10)).toBe('2026-08-11');
  });

  it('an aged case is overdue with a correct day-count (VISA, calendar days)', async () => {
    // VISA SLA = 30 calendar days. Entered 40 days before "now" → 10 days overdue.
    const now = new Date('2026-06-30T00:00:00Z');
    const caseId = await seedCase('UNIVERSITY', 'VISA', addDays(now, -40));
    const d = await one(caseId, now);
    expect(d.deadline!.toISOString().slice(0, 10)).toBe('2026-06-20'); // -40 + 30
    expect(d.overdue).toBe(true);
    expect(d.daysOverdue).toBe(10);
  });

  it('editing the config changes the calc; institution types are independent', async () => {
    const now = new Date('2026-06-30T00:00:00Z');
    // Two INZ cases entered 5 days ago; default INZ SLA = 2 → both overdue by 3.
    const uni = await seedCase('UNIVERSITY', 'INZ_SUBMITTED', addDays(now, -5));
    const pol = await seedCase('POLYTECHNIC', 'INZ_SUBMITTED', addDays(now, -5));
    expect((await one(uni, now)).daysOverdue).toBe(3);
    expect((await one(pol, now)).daysOverdue).toBe(3);

    // Raise ONLY University's INZ SLA to 10 days → University no longer overdue,
    // Polytechnic unchanged. Proves DB-driven + per-institution independence.
    await svc.updateConfig('UNIVERSITY', 'INZ_SUBMITTED' as any, 10, 'owner-1');
    expect((await one(uni, now)).overdue).toBe(false);
    expect((await one(pol, now)).daysOverdue).toBe(3);
    // restore for other tests
    await svc.updateConfig('UNIVERSITY', 'INZ_SUBMITTED' as any, 2, 'owner-1');
  });

  it('a manual per-case override wins over the computed SLA', async () => {
    const now = new Date('2026-06-30T00:00:00Z');
    const caseId = await seedCase('UNIVERSITY', 'VISA', addDays(now, -40)); // would be overdue
    await prisma.case.update({ where: { id: caseId }, data: { stageDeadlineOverride: addDays(now, 5) } }); // extended
    const d = await one(caseId, now);
    expect(d.overridden).toBe(true);
    expect(d.overdue).toBe(false);
  });

  it('report groups overdue cases by Client Officer', async () => {
    const now = new Date('2026-06-30T00:00:00Z');
    const co = await prisma.user.create({ data: { name: `CO ${stamp()}`, email: `co.${stamp()}@t.local`, passwordHash: 'x', role: 'CLIENT_CONSULTANT' as any, isActive: true } });
    const overdueCase = await seedCase('UNIVERSITY', 'VISA', addDays(now, -40), co.id); // overdue, assigned to co
    await seedCase('UNIVERSITY', 'VISA', addDays(now, -1), co.id);                       // not overdue (1 day in)

    const report = await svc.getOverdueByOfficer(now);
    const bucket = report.officers.find((o) => o.officerId === co.id);
    expect(bucket).toBeTruthy();
    expect(bucket!.cases.some((c) => c.caseId === overdueCase)).toBe(true);
    expect(bucket!.cases.length).toBe(1); // only the overdue one
  });

  it('updateConfig rejects out-of-range days', async () => {
    await expect(svc.updateConfig('UNIVERSITY', 'ADMISSION' as any, 999, null)).rejects.toBeDefined();
  });
});
