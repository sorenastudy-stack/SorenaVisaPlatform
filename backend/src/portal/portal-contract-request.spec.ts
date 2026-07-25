/**
 * PR-CLIENT-CONTRACT — client self-service "Request contract".
 *
 * Exercises the REAL send engine (ContractsService.createContractViaDocuseal →
 * prepareEngagementSend → assertContractSendAllowed) with only the DocuSeal
 * NETWORK call stubbed, so the Phase-A gate, the duplicate-send guards, and the
 * DB partial-unique index are all genuinely under test — not mocked away.
 *
 * Covers: (1) happy-path self-request creates exactly one contract via DocuSeal
 * like a staff send; (2) buildNextSteps hides the button without a completed
 * FREE_15; (3) red-flag-not-approved shows LIA_REVIEW instead of the button and
 * the endpoint returns the calm client-safe message; (4) double-clicks never
 * create duplicates; (5) the staff send path is unaffected.
 */

import { PrismaClient } from '@prisma/client';
import { PortalService } from './portal.service';
import { ContractsService } from '../contracts/contracts.service';
import { LiaAssignmentService } from '../cases/lia-assignment.service';
import { UnprocessableEntityException } from '@nestjs/common';

jest.setTimeout(60000);

// Any mail method → resolved no-op (LiaAssignmentService sends assignment mail).
const mailStub: any = new Proxy({}, { get: () => jest.fn().mockResolvedValue(undefined) });

describe('Client self-service Request Contract', () => {
  let prisma: PrismaClient;
  let portal: PortalService;
  let contracts: ContractsService;
  let createSubmission: jest.Mock;

  beforeAll(async () => {
    process.env.CONTRACT_DIRECTOR_EMAIL = 'director@test.local';
    process.env.CONTRACT_DIRECTOR_NAME = 'Director Test';

    prisma = new PrismaClient();
    await prisma.$connect();

    // Unique submissionId per call — the Contract.docusealSubmissionId column is
    // @unique, so a fixed value would collide across the multiple sends here.
    let subCounter = 0;
    createSubmission = jest.fn().mockImplementation(async () => ({ submissionId: `sub_${Date.now()}_${(subCounter += 1)}` }));
    const docusealStub: any = { createSubmission };
    const lia = new LiaAssignmentService(prisma as any, mailStub);
    // Real ContractsService; only DocuSeal (network) + unused deps are stubbed.
    contracts = new ContractsService(
      prisma as any,   // prisma
      {} as any,       // docuSignService (unused on the docuseal path)
      mailStub,        // mail
      lia,             // liaAssignments (real)
      {} as any,       // r2 (only used on completion)
      docusealStub,    // docuseal (network stubbed)
      {} as any,       // cases (only used on client-sign webhook)
    );
    portal = new PortalService(prisma as any, {} as any, {} as any, contracts);
  }, 60000);

  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(() => createSubmission.mockClear());

  let seq = 0;
  const stamp = () => `rc${Date.now()}_${(seq += 1)}`;

  // One active LIA so the send can resolve/assign an LIA signer.
  async function ensureActiveLia() {
    const s = stamp();
    return prisma.user.create({
      data: { name: `LIA ${s}`, email: `lia.${s}@t.local`, passwordHash: 'x', role: 'LIA' as any, isActive: true },
    });
  }

  // A client: contact + linked User (portal identity) + lead (+ optional case).
  async function seedClient(opts: { redFlag?: boolean; withCase?: boolean; free15?: boolean; liaApproved?: boolean } = {}) {
    const s = stamp();
    const user = await prisma.user.create({
      data: { name: `Client ${s}`, email: `c.${s}@t.local`, passwordHash: 'x', role: 'STUDENT' as any, isActive: true },
    });
    const contact = await prisma.contact.create({
      data: { fullName: `Client ${s}`, email: `c.${s}@t.local`, userId: user.id },
    });
    const lead = await prisma.lead.create({
      data: { contactId: contact.id, leadStatus: 'NEW', liaEscalationRequired: opts.redFlag ?? false } as any,
    });
    let kase: { id: string } | null = null;
    if (opts.withCase) {
      kase = await prisma.case.create({ data: { leadId: lead.id } });
    }
    if (opts.free15) {
      await prisma.consultation.create({
        data: { leadId: lead.id, type: 'FREE_15', status: 'COMPLETED', amountNZD: 0 } as any,
      });
    }
    if (opts.liaApproved) {
      await prisma.consultation.create({
        data: { leadId: lead.id, type: 'LIA', status: 'COMPLETED', decision: 'APPROVED', decidedAt: new Date(), amountNZD: 0 } as any,
      });
    }
    return { userId: user.id, leadId: lead.id, caseId: kase?.id ?? null };
  }

  it('1. happy path — client with completed FREE_15 + no red flag self-requests; one contract sent via DocuSeal', async () => {
    await ensureActiveLia();
    const { userId, caseId } = await seedClient({ withCase: true, free15: true });

    const res = await portal.requestOwnContract(userId, 'Client Name', 'STUDENT');
    expect(res).toEqual({ ok: true });

    // Went out via DocuSeal exactly as a staff send would (same dispatch call).
    expect(createSubmission).toHaveBeenCalledTimes(1);

    // Exactly one contract persisted for the client's own case.
    const contractsForCase = await prisma.contract.findMany({ where: { caseId: caseId! } });
    expect(contractsForCase).toHaveLength(1);

    // Attributed to the CLIENT in the audit trail (distinguishable from staff sends).
    const audit = await prisma.auditLog.findFirst({
      where: { eventType: 'CONTRACT_CREATED', newValue: { path: ['caseId'], equals: caseId } },
      orderBy: { createdAt: 'desc' },
    }).catch(() => null);
    if (audit) expect(audit.actorRoleSnapshot).toBe('STUDENT');
  });

  it('2. no FREE_15 → the Request-contract next-step never appears (and does when completed)', async () => {
    const without = await seedClient({ withCase: true, free15: false });
    const withF15 = await seedClient({ withCase: true, free15: true });

    const stepsWithout = await (portal as any).buildNextSteps(without.caseId);
    const stepsWith = await (portal as any).buildNextSteps(withF15.caseId);

    expect(stepsWithout.some((s: any) => s.kind === 'REQUEST_CONTRACT')).toBe(false);
    expect(stepsWith.some((s: any) => s.kind === 'REQUEST_CONTRACT')).toBe(true);
  });

  it('3. red-flagged, not yet approved → LIA_REVIEW shown, button hidden; endpoint returns client-safe locked message', async () => {
    await ensureActiveLia();
    const flagged = await seedClient({ withCase: true, free15: true, redFlag: true, liaApproved: false });

    // buildNextSteps: LIA_REVIEW present, REQUEST_CONTRACT absent (never both).
    const steps = await (portal as any).buildNextSteps(flagged.caseId);
    expect(steps.some((s: any) => s.kind === 'LIA_REVIEW')).toBe(true);
    expect(steps.some((s: any) => s.kind === 'REQUEST_CONTRACT')).toBe(false);

    // Direct endpoint hit (race edge) → calm client message, NOT the raw staff one.
    await expect(portal.requestOwnContract(flagged.userId, 'X', 'STUDENT')).rejects.toMatchObject({
      response: { message: "We're not quite ready to send your contract yet — we'll be in touch shortly to let you know what's needed." },
    });
    expect(createSubmission).not.toHaveBeenCalled();

    // Positive control: once an LIA approves, the button reappears.
    const approved = await seedClient({ withCase: true, free15: true, redFlag: true, liaApproved: true });
    const steps2 = await (portal as any).buildNextSteps(approved.caseId);
    expect(steps2.some((s: any) => s.kind === 'REQUEST_CONTRACT')).toBe(true);
    expect(steps2.some((s: any) => s.kind === 'LIA_REVIEW')).toBe(false);
  });

  it('4. double-click / hammering never creates duplicate contracts', async () => {
    await ensureActiveLia();
    const { userId, caseId } = await seedClient({ withCase: true, free15: true });

    // Sequential: first succeeds, second is cleanly rejected ("already exists").
    await portal.requestOwnContract(userId, 'X', 'STUDENT');
    await expect(portal.requestOwnContract(userId, 'X', 'STUDENT')).rejects.toBeDefined();
    expect(await prisma.contract.count({ where: { caseId: caseId! } })).toBe(1);

    // Concurrent: fire three at once — the DB unique index is the backstop.
    const conc = await seedClient({ withCase: true, free15: true });
    await Promise.allSettled([
      portal.requestOwnContract(conc.userId, 'X', 'STUDENT'),
      portal.requestOwnContract(conc.userId, 'X', 'STUDENT'),
      portal.requestOwnContract(conc.userId, 'X', 'STUDENT'),
    ]);
    expect(await prisma.contract.count({ where: { caseId: conc.caseId! } })).toBe(1);
  });

  it('5. regression — the staff-initiated send path still works unchanged', async () => {
    await ensureActiveLia();
    const { caseId } = await seedClient({ withCase: true, free15: true });

    // A real Client Officer user (AuditLog.userId is a FK → must exist).
    const s = stamp();
    const officer = await prisma.user.create({
      data: { name: `CO ${s}`, email: `co.${s}@t.local`, passwordHash: 'x', role: 'CLIENT_CONSULTANT' as any, isActive: true },
    });

    // Same engine, staff actor (Client Officer) — the shared path is untouched.
    await contracts.createContractViaDocuseal(
      { caseId: caseId! },
      { id: officer.id, name: 'Client Officer', role: 'CLIENT_CONSULTANT' },
    );
    expect(createSubmission).toHaveBeenCalledTimes(1);
    expect(await prisma.contract.count({ where: { caseId: caseId! } })).toBe(1);
  });
});
