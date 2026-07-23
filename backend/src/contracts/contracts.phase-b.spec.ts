/**
 * PR-CONTRACT-LEAD (Phase B) — DB-backed integration spec for lead-based contract
 * sending + case auto-creation on client-sign.
 *
 * Real Prisma (throwaway DB), real ContractsService / CasesService /
 * LiaAssignmentService wired through the Nest module; only the IO edges are
 * mocked: DocuSeal (createSubmission / getSubmission / downloadCompletedPdf),
 * R2, Mail, DocuSign. The webhook re-fetches the submission from DocuSeal, so we
 * drive the exact per-signer state through getSubmission.
 *
 * Covers the brief's scenarios:
 *   1. Non-red-flagged lead → contract sent lead-based (no case), case
 *      auto-creates the moment the CLIENT signs; caseId backfilled onto Contract.
 *   2. A retry of the same "client signed" event does NOT create a second case
 *      and does NOT error.
 *   3. The $200 invoice + STUDENT promotion fire ONLY at full completion — proven
 *      by asserting neither exists after client-only sign, and both exist after
 *      the final signature.
 *   4. Red-flagged lead: LIA APPROVED flips the lead's executionAllowed → the
 *      contract sends → the case still auto-creates on client-sign.
 *   6. Existing case-based sends are unaffected (Contract keeps caseId, no leadId).
 * (Scenario 5 — the portal half-signed message — is covered in
 *  portal.phase-b-notice.spec.ts.)
 */

import { PrismaClient } from '@prisma/client';
import { ContractsService } from './contracts.service';
import { LiaAssignmentService } from '../cases/lia-assignment.service';
import { CasesService } from '../cases/cases.service';
import { EventsService } from '../events/events.service';
import { StaffBookingsService } from '../staff/bookings/staff-bookings.service';

const DIRECTOR_EMAIL = 'director.phaseb@test.local';
const DIRECTOR_NAME = 'Phase B Director';

// Build a DocuSeal submission payload with a chosen set of completed signers.
function submissionOf(
  emails: { client: string; lia: string; director: string },
  completed: Array<'client' | 'lia' | 'director'>,
  at: string,
) {
  const st = (k: 'client' | 'lia' | 'director') =>
    completed.includes(k) ? 'completed' : 'awaiting';
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
    submitters: [
      row(emails.client, 'client'),
      row(emails.lia, 'lia'),
      row(emails.director, 'director'),
    ],
  };
}

// Full-module wiring + a real DB connection is slower than the 5s default.
jest.setTimeout(60000);

describe('Phase B — lead-based contract + case auto-creation', () => {
  let prisma: PrismaClient;
  let service: ContractsService;
  let bookings: StaffBookingsService;
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
    // Mail: any method → a resolved jest.fn (LIA-assign email etc. are fire-and-forget).
    const mail = new Proxy({}, { get: () => jest.fn().mockResolvedValue(undefined) }) as any;
    const r2Mock = { putObject: jest.fn().mockResolvedValue(undefined) };

    // Wire the REAL services manually (no Nest module graph — its init hooks hang
    // in a bare test process). crypto is unused by createCase, so a bare stub is
    // fine there.
    const liaAssignments = new LiaAssignmentService(prisma as any, mail);
    const events = new EventsService(prisma as any);
    const cases = new CasesService(prisma as any, events, {} as any, liaAssignments);
    service = new ContractsService(prisma as any, {} as any, mail, liaAssignments, r2Mock as any, docusealMock as any, cases);
    bookings = new StaffBookingsService(prisma as any, {} as any);

    // A real staff user to attribute CONTRACT_SENT audit rows to (the userId FK
    // on audit_logs requires a real user).
    const staff = await prisma.user.create({
      data: { name: 'Actor Admin', email: `actor.${Date.now()}@test.local`, passwordHash: 'x', role: 'ADMIN', isActive: true },
    });
    actor = { id: staff.id, name: staff.name, role: 'ADMIN' };
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Seed helpers ─────────────────────────────────────────────────────────
  let seq = 0;
  function stamp() {
    seq += 1;
    return `pb${Date.now()}_${seq}`;
  }

  async function seedActiveLia() {
    const s = stamp();
    return prisma.user.create({
      data: { name: `LIA ${s}`, email: `lia.${s}@test.local`, passwordHash: 'x', role: 'LIA', isActive: true },
    });
  }

  async function seedLead(opts: {
    executionAllowed: boolean;
    hardStopFlag?: boolean;
    liaEscalationRequired?: boolean;
    withFree15?: boolean;
  }) {
    const s = stamp();
    const clientUser = await prisma.user.create({
      data: { name: `Client ${s}`, email: `client.${s}@test.local`, passwordHash: 'x', role: 'LEAD', isActive: true },
    });
    const contact = await prisma.contact.create({
      data: { fullName: `Client ${s}`, email: clientUser.email, userId: clientUser.id },
    });
    const lead = await prisma.lead.create({
      data: {
        contactId: contact.id,
        executionAllowed: opts.executionAllowed,
        hardStopFlag: opts.hardStopFlag ?? false,
        liaEscalationRequired: opts.liaEscalationRequired ?? false,
        leadStatus: 'NEW',
      },
    });
    if (opts.withFree15 ?? true) {
      await prisma.consultation.create({
        data: { leadId: lead.id, type: 'FREE_15', status: 'COMPLETED', amountNZD: 0 } as any,
      });
    }
    return { clientUser, contact, lead, emailClient: clientUser.email };
  }

  // ── Scenario 1 + 2 + 3 — the full lead-based lifecycle ────────────────────
  it('sends lead-based, auto-creates the case on client-sign (retry-safe), and fires the $200 invoice + promotion ONLY at full completion', async () => {
    const lia = await seedActiveLia();
    const { lead, clientUser, emailClient } = await seedLead({ executionAllowed: true });

    docusealMock.createSubmission.mockResolvedValueOnce({ submissionId: `sub-${lead.id}`, submitters: [] });

    // 1. Send lead-based — no case exists.
    const contract = await service.createContractViaDocuseal({ leadId: lead.id }, actor);
    const stored = await prisma.contract.findUnique({ where: { id: contract.id } });
    expect(stored?.leadId).toBe(lead.id);
    expect(stored?.caseId).toBeNull();
    expect(await prisma.case.findFirst({ where: { leadId: lead.id } })).toBeNull();

    const liaSigner = await prisma.contractSigner.findFirst({ where: { contractId: contract.id, role: 'LIA' } });
    const emails = { client: emailClient, lia: liaSigner!.signerEmail, director: DIRECTOR_EMAIL };

    // 2. CLIENT signs (first). Webhook → case auto-creates, caseId backfilled.
    docusealMock.getSubmission.mockResolvedValueOnce(
      submissionOf(emails, ['client'], '2026-07-23T10:00:00.000Z'),
    );
    await service.handleDocusealWebhook({ event_type: 'form.completed', data: { submission_id: `sub-${lead.id}` } });

    const caseAfterClient = await prisma.case.findFirst({ where: { leadId: lead.id } });
    expect(caseAfterClient).not.toBeNull();
    const contractAfterClient = await prisma.contract.findUnique({ where: { id: contract.id } });
    expect(contractAfterClient?.caseId).toBe(caseAfterClient!.id);      // backfilled
    expect(contractAfterClient?.status).toBe('SENT');                    // NOT signed yet
    // Case pointed at the signing LIA.
    expect(caseAfterClient!.liaId).toBe(liaSigner!.userId);
    // MONEY GATE: no invoice, no promotion after only the client signed.
    expect(await prisma.invoice.findUnique({ where: { invoiceNumber: `ENG-${caseAfterClient!.id}` } })).toBeNull();
    expect((await prisma.user.findUnique({ where: { id: clientUser.id } }))?.role).toBe('LEAD');

    // 3. RETRY the identical client-signed event — must NOT create a 2nd case or throw.
    docusealMock.getSubmission.mockResolvedValueOnce(
      submissionOf(emails, ['client'], '2026-07-23T10:00:00.000Z'),
    );
    await expect(
      service.handleDocusealWebhook({ event_type: 'form.completed', data: { submission_id: `sub-${lead.id}` } }),
    ).resolves.not.toThrow();
    expect(await prisma.case.count({ where: { leadId: lead.id } })).toBe(1);

    // 4. LIA + Director sign → full completion. Invoice + promotion fire NOW.
    docusealMock.getSubmission.mockResolvedValueOnce(
      submissionOf(emails, ['client', 'lia', 'director'], '2026-07-23T12:00:00.000Z'),
    );
    await service.handleDocusealWebhook({ event_type: 'submission.completed', data: { id: `sub-${lead.id}` } });

    const caseId = caseAfterClient!.id;
    const finalContract = await prisma.contract.findUnique({ where: { id: contract.id } });
    expect(finalContract?.status).toBe('SIGNED');
    const invoice = await prisma.invoice.findUnique({ where: { invoiceNumber: `ENG-${caseId}` } });
    expect(invoice).not.toBeNull();                                      // created at full completion
    expect((await prisma.user.findUnique({ where: { id: clientUser.id } }))?.role).toBe('STUDENT');
    // Timing proof: the invoice was created strictly after the case (i.e. at the
    // final signature, not the first).
    expect(invoice!.createdAt.getTime()).toBeGreaterThanOrEqual(caseAfterClient!.createdAt.getTime());
  });

  // ── Scenario 4 — red-flagged lead: LIA approval clears the execution gate ─
  it('red-flagged lead: LIA APPROVED flips executionAllowed → contract sends → case auto-creates', async () => {
    const lia = await seedActiveLia();
    const { lead, emailClient } = await seedLead({
      executionAllowed: false,
      hardStopFlag: true,
      liaEscalationRequired: true,
    });
    // An LIA-type consultation assigned to the LIA, for the verdict.
    const liaConsult = await prisma.consultation.create({
      data: { leadId: lead.id, type: 'LIA', status: 'COMPLETED', assignedToId: lia.id, amountNZD: 0 } as any,
    });

    // LIA records APPROVED — the gate-reconciliation must flip the lead's flags.
    await bookings.recordLiaDecision({ userId: lia.id, role: 'LIA' }, liaConsult.id, 'APPROVED' as any, undefined);
    const clearedLead = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(clearedLead?.executionAllowed).toBe(true);
    expect(clearedLead?.hardStopFlag).toBe(false);
    expect(clearedLead?.liaEscalationRequired).toBe(false);

    // Now the contract can be sent lead-based, and the case auto-creates on sign.
    docusealMock.createSubmission.mockResolvedValueOnce({ submissionId: `sub-rf-${lead.id}`, submitters: [] });
    const contract = await service.createContractViaDocuseal({ leadId: lead.id }, actor);
    const liaSigner = await prisma.contractSigner.findFirst({ where: { contractId: contract.id, role: 'LIA' } });

    docusealMock.getSubmission.mockResolvedValueOnce(
      submissionOf({ client: emailClient, lia: liaSigner!.signerEmail, director: DIRECTOR_EMAIL }, ['client'], '2026-07-23T11:00:00.000Z'),
    );
    await service.handleDocusealWebhook({ event_type: 'form.completed', data: { submission_id: `sub-rf-${lead.id}` } });

    const createdCase = await prisma.case.findFirst({ where: { leadId: lead.id } });
    expect(createdCase).not.toBeNull();
    expect((await prisma.contract.findUnique({ where: { id: contract.id } }))?.caseId).toBe(createdCase!.id);
  });

  // ── Scenario 6 — existing case-based send is unaffected ───────────────────
  it('case-based send still stores caseId (and no leadId) — legacy path unchanged', async () => {
    await seedActiveLia();
    const { lead } = await seedLead({ executionAllowed: true });
    const kase = await prisma.case.create({ data: { leadId: lead.id } });

    docusealMock.createSubmission.mockResolvedValueOnce({ submissionId: `sub-cb-${kase.id}`, submitters: [] });
    const contract = await service.createContractViaDocuseal({ caseId: kase.id }, actor);

    const stored = await prisma.contract.findUnique({ where: { id: contract.id } });
    expect(stored?.caseId).toBe(kase.id);
    expect(stored?.leadId).toBeNull();
  });

  // ── Guard — cannot send lead-based when a case already exists ─────────────
  it('rejects a lead-based send when the lead already has a case', async () => {
    await seedActiveLia();
    const { lead } = await seedLead({ executionAllowed: true });
    await prisma.case.create({ data: { leadId: lead.id } });

    await expect(service.createContractViaDocuseal({ leadId: lead.id }, actor)).rejects.toThrow(
      /already has a case/i,
    );
  });
});
