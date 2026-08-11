import { PrismaClient } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { assertCaseReadable } from './assert-case-read';

/**
 * PR-ACCESS-AUDIT — the case-read gate.
 *
 * Two staff endpoints — employment-entries and recommendations — admitted five
 * roles and then read whichever case the caller named. The role gate said who
 * may ask; nothing said which case. A CONSULTANT could read the employment
 * history on a colleague's client by changing the id in the URL.
 *
 * Against a real database, because the thing under test is a query plus a
 * decision made on what it returns; a mocked case would only prove the helper
 * calls a function, not that the boundary holds.
 *
 * The LIA clause is asserted here deliberately. "LIA sees all cases" is a
 * locked operational policy, not an accident, and a test that pins it means a
 * future change to it has to be a decision rather than a side effect.
 */

jest.setTimeout(60000);

describe('assertCaseReadable', () => {
  let prisma: PrismaClient;

  const made = { cases: [] as string[], leads: [] as string[], contacts: [] as string[], users: [] as string[] };

  let consultantA: string, consultantB: string;
  let clientConsultantA: string, clientConsultantB: string;
  let ownerUser: string, liaUser: string, supportUser: string;
  let caseOfA: string;

  let seq = 0;
  const stamp = () => `cg${Date.now()}_${(seq += 1)}`;

  async function mkUser(role: string) {
    const s = stamp();
    const u = await prisma.user.create({
      data: {
        name: `${role} ${s}`, email: `${role.toLowerCase()}.${s}@t.local`,
        passwordHash: 'x', role: role as any, isActive: true,
      },
    });
    made.users.push(u.id);
    return u.id;
  }

  async function mkCase(slots: Record<string, string | null>) {
    const s = stamp();
    const c = await prisma.contact.create({ data: { fullName: `C ${s}`, email: `c.${s}@t.local` } });
    made.contacts.push(c.id);
    const l = await prisma.lead.create({ data: { contactId: c.id, leadStatus: 'NEW' } as any });
    made.leads.push(l.id);
    const k = await prisma.case.create({ data: { leadId: l.id, ...slots } as any });
    made.cases.push(k.id);
    return k.id;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    consultantA = await mkUser('CONSULTANT');
    consultantB = await mkUser('CONSULTANT');
    clientConsultantA = await mkUser('CLIENT_CONSULTANT');
    clientConsultantB = await mkUser('CLIENT_CONSULTANT');
    ownerUser = await mkUser('OWNER');
    liaUser = await mkUser('LIA');
    supportUser = await mkUser('SUPPORT');

    // One case, held by consultantA (admission) and clientConsultantA.
    caseOfA = await mkCase({ ownerId: consultantA, consultantId: clientConsultantA });
  }, 60000);

  afterAll(async () => {
    await prisma.case.deleteMany({ where: { id: { in: made.cases } } }).catch(() => {});
    await prisma.lead.deleteMany({ where: { id: { in: made.leads } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { id: { in: made.contacts } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => {});
    await prisma.$disconnect();
  });

  const viewer = (userId: string, role: string) => ({ userId, role });

  it('lets the CONSULTANT who holds the case read it', async () => {
    await expect(
      assertCaseReadable(prisma as any, caseOfA, viewer(consultantA, 'CONSULTANT')),
    ).resolves.toBeUndefined();
  });

  it('refuses a CONSULTANT who does not hold the case', async () => {
    await expect(
      assertCaseReadable(prisma as any, caseOfA, viewer(consultantB, 'CONSULTANT')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets the CLIENT_CONSULTANT who holds the case read it', async () => {
    await expect(
      assertCaseReadable(prisma as any, caseOfA, viewer(clientConsultantA, 'CLIENT_CONSULTANT')),
    ).resolves.toBeUndefined();
  });

  it('refuses a CLIENT_CONSULTANT who does not hold the case', async () => {
    await expect(
      assertCaseReadable(prisma as any, caseOfA, viewer(clientConsultantB, 'CLIENT_CONSULTANT')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a SUPPORT user who holds no slot on the case', async () => {
    await expect(
      assertCaseReadable(prisma as any, caseOfA, viewer(supportUser, 'SUPPORT')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers a denied case exactly as it answers a missing one', async () => {
    // Both NOT FOUND, and the same message: "that case exists but is not yours"
    // is itself a disclosure.
    const denied = await assertCaseReadable(prisma as any, caseOfA, viewer(consultantB, 'CONSULTANT'))
      .catch((e) => e);
    const missing = await assertCaseReadable(prisma as any, 'no-such-case-id', viewer(consultantB, 'CONSULTANT'))
      .catch((e) => e);

    expect(denied).toBeInstanceOf(NotFoundException);
    expect(missing).toBeInstanceOf(NotFoundException);
    expect(denied.message).toBe(missing.message);
  });

  it('lets admin tier read any case', async () => {
    await expect(
      assertCaseReadable(prisma as any, caseOfA, viewer(ownerUser, 'OWNER')),
    ).resolves.toBeUndefined();
  });

  it('lets LIA read any case — the locked Operations-Manual read model', async () => {
    await expect(
      assertCaseReadable(prisma as any, caseOfA, viewer(liaUser, 'LIA')),
    ).resolves.toBeUndefined();
  });

  it('refuses an unidentifiable caller outright', async () => {
    await expect(
      assertCaseReadable(prisma as any, caseOfA, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      assertCaseReadable(prisma as any, caseOfA, { userId: '', role: 'CONSULTANT' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
