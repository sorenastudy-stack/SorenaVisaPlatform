/**
 * PR-ACCESS-GATE (Phase C) — DB-backed integration spec for the moved trigger
 * timing: the $200 engagement invoice + LEAD→STUDENT promotion now fire the
 * moment the LIA countersigns (client has already signed), NOT at full 3-party
 * completion. The Director's final signature triggers neither.
 *
 * Same manual-wiring harness as contracts.phase-b.spec.ts. Uses a CASE-based
 * contract (caseId present from send) — which also serves as the regression
 * check that existing case-based contracts behave correctly under the new timing.
 *
 * Sequence asserted (the brief's exact test):
 *   Client signs           → NO invoice yet, client still LEAD, contract SENT
 *   LIA signs (Dir pending)→ invoice EXISTS, client STUDENT, contract still SENT
 *   (retry LIA-signed)     → still ONE invoice, still STUDENT (idempotent)
 *   Director signs (all)   → no 2nd invoice, no re-promote, contract SIGNED
 */

import { PrismaClient } from '@prisma/client';
import { ContractsService } from './contracts.service';
import { LiaAssignmentService } from '../cases/lia-assignment.service';
import { CasesService } from '../cases/cases.service';
import { EventsService } from '../events/events.service';

const DIRECTOR_EMAIL = 'director.phasec@test.local';
const DIRECTOR_NAME = 'Phase C Director';

function submissionOf(
  emails: { client: string; lia: string; director: string },
  completed: Array<'client' | 'lia' | 'director'>,
  at: string,
) {
  const st = (k: 'client' | 'lia' | 'director') => (completed.includes(k) ? 'completed' : 'awaiting');
  const row = (email: string, k: 'client' | 'lia' | 'director') => ({
    email,
    status: st(k),
    ...(completed.includes(k) ? { completed_at: at } : {}),
    values: [],
  });
  const allDone = completed.length === 3;
  return {
    id: 1,
    status: allDone ? 'completed' : 'pending',
    ...(allDone ? { completed_at: at } : {}),
    submitters: [row(emails.client, 'client'), row(emails.lia, 'lia'), row(emails.director, 'director')],
  };
}

jest.setTimeout(60000);

describe('Phase C — invoice + promotion fire at LIA-signed (not full completion)', () => {
  let prisma: PrismaClient;
  let service: ContractsService;
  let docusealMock: { createSubmission: jest.Mock; getSubmission: jest.Mock; downloadCompletedPdf: jest.Mock; extractVisaType: jest.Mock };
  let actor: { id: string; name: string | null; role: string };

  beforeAll(async () => {
    process.env.CONTRACT_DIRECTOR_EMAIL = DIRECTOR_EMAIL;
    process.env.CONTRACT_DIRECTOR_NAME = DIRECTOR_NAME;
    process.env.CONTRACT_PROVIDER = 'docuseal';

    prisma = new PrismaClient();
    await prisma.$connect();

    docusealMock = {
      createSubmission: jest.fn(),
      getSubmission: jest.fn(),
      downloadCompletedPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
      extractVisaType: jest.fn().mockReturnValue(null),
    };
    const mail = new Proxy({}, { get: () => jest.fn().mockResolvedValue(undefined) }) as any;
    const r2Mock = { putObject: jest.fn().mockResolvedValue(undefined) };

    const liaAssignments = new LiaAssignmentService(prisma as any, mail);
    const events = new EventsService(prisma as any);
    const cases = new CasesService(prisma as any, events, {} as any, liaAssignments);
    service = new ContractsService(prisma as any, {} as any, mail, liaAssignments, r2Mock as any, docusealMock as any, cases);

    const staff = await prisma.user.create({
      data: { name: 'Actor Admin', email: `actor.pc.${Date.now()}@test.local`, passwordHash: 'x', role: 'ADMIN', isActive: true },
    });
    actor = { id: staff.id, name: staff.name, role: 'ADMIN' };
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  let seq = 0;
  const stamp = () => `pc${Date.now()}_${(seq += 1)}`;

  async function seedCaseBasedContract() {
    const s = stamp();
    await prisma.user.create({
      data: { name: `LIA ${s}`, email: `lia.${s}@test.local`, passwordHash: 'x', role: 'LIA', isActive: true },
    });
    const clientUser = await prisma.user.create({
      data: { name: `Client ${s}`, email: `client.${s}@test.local`, passwordHash: 'x', role: 'LEAD', isActive: true },
    });
    const contact = await prisma.contact.create({
      data: { fullName: `Client ${s}`, email: clientUser.email, userId: clientUser.id },
    });
    const lead = await prisma.lead.create({
      data: { contactId: contact.id, executionAllowed: true, leadStatus: 'NEW' },
    });
    await prisma.consultation.create({
      data: { leadId: lead.id, type: 'FREE_15', status: 'COMPLETED', amountNZD: 0 } as any,
    });
    const kase = await prisma.case.create({ data: { leadId: lead.id } });

    docusealMock.createSubmission.mockResolvedValueOnce({ submissionId: `sub-${kase.id}`, submitters: [] });
    const contract = await service.createContractViaDocuseal({ caseId: kase.id }, actor);
    const liaSigner = await prisma.contractSigner.findFirst({ where: { contractId: contract.id, role: 'LIA' } });

    return {
      contract,
      caseId: kase.id,
      clientUserId: clientUser.id,
      submissionId: `sub-${kase.id}`,
      emails: { client: clientUser.email, lia: liaSigner!.signerEmail, director: DIRECTOR_EMAIL },
    };
  }

  const engInvoice = (caseId: string) =>
    prisma.invoice.findUnique({ where: { invoiceNumber: `ENG-${caseId}` } });
  const engInvoiceCount = (caseId: string) =>
    prisma.invoice.count({ where: { invoiceNumber: `ENG-${caseId}` } });
  const roleOf = async (userId: string) =>
    (await prisma.user.findUnique({ where: { id: userId } }))?.role;
  const statusOf = async (contractId: string) =>
    (await prisma.contract.findUnique({ where: { id: contractId } }))?.status;

  it('Client → LIA → Director: invoice + promotion at LIA-signed, nothing new at Director', async () => {
    const { contract, caseId, clientUserId, submissionId, emails } = await seedCaseBasedContract();

    const fire = (completed: Array<'client' | 'lia' | 'director'>, at: string) => {
      docusealMock.getSubmission.mockResolvedValueOnce(submissionOf(emails, completed, at));
      return service.handleDocusealWebhook({ event_type: 'form.completed', data: { submission_id: submissionId } });
    };

    // 1. CLIENT signs — nothing financial yet.
    await fire(['client'], '2026-07-24T10:00:00.000Z');
    expect(await engInvoice(caseId)).toBeNull();
    expect(await roleOf(clientUserId)).toBe('LEAD');
    expect(await statusOf(contract.id)).toBe('SENT');

    // 2. LIA signs (Director still pending) — invoice + promotion fire NOW.
    await fire(['client', 'lia'], '2026-07-24T11:00:00.000Z');
    const invoiceAfterLia = await engInvoice(caseId);
    expect(invoiceAfterLia).not.toBeNull();
    expect(invoiceAfterLia!.status).toBe('SENT'); // raised, unpaid → gate still locked until paid
    expect(await roleOf(clientUserId)).toBe('STUDENT');
    expect(await statusOf(contract.id)).toBe('SENT'); // contract NOT fully signed yet

    // 3. Retry the identical LIA-signed event — idempotent, no duplicates.
    await fire(['client', 'lia'], '2026-07-24T11:00:00.000Z');
    expect(await engInvoiceCount(caseId)).toBe(1);
    expect(await roleOf(clientUserId)).toBe('STUDENT');

    // 4. DIRECTOR signs (submission.completed) — no 2nd invoice, no re-promote,
    //    contract now fully SIGNED.
    docusealMock.getSubmission.mockResolvedValueOnce(submissionOf(emails, ['client', 'lia', 'director'], '2026-07-24T12:00:00.000Z'));
    await service.handleDocusealWebhook({ event_type: 'submission.completed', data: { id: submissionId } });
    expect(await engInvoiceCount(caseId)).toBe(1);
    expect((await engInvoice(caseId))!.id).toBe(invoiceAfterLia!.id); // same invoice
    expect(await roleOf(clientUserId)).toBe('STUDENT');
    expect(await statusOf(contract.id)).toBe('SIGNED');
  });

  it('safety net: a coalesced submission.completed (never saw a partial event) still invoices + promotes', async () => {
    const { contract, caseId, clientUserId, submissionId, emails } = await seedCaseBasedContract();

    // The very first webhook we see is all-3-signed → the LIA-signed partial
    // branch never ran; the allCompleted safety net must still fire.
    docusealMock.getSubmission.mockResolvedValueOnce(submissionOf(emails, ['client', 'lia', 'director'], '2026-07-24T12:00:00.000Z'));
    await service.handleDocusealWebhook({ event_type: 'submission.completed', data: { id: submissionId } });

    expect(await engInvoiceCount(caseId)).toBe(1);
    expect(await roleOf(clientUserId)).toBe('STUDENT');
    expect(await statusOf(contract.id)).toBe('SIGNED');
  });
});
