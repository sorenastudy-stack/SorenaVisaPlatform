/**
 * PR-DOCUSEAL — harness test for ContractsService.handleDocusealWebhook.
 *
 * Drives the real orchestration with a hand-rolled prisma mock + a real
 * DocusealService whose network calls are stubbed. Verifies that a
 * submission.completed event: marks the contract SIGNED, captures the LIA's
 * visaType checkbox onto the case, stores the completed PDF as a Document, and
 * runs BOTH downstream steps (engagement invoice + LEAD→STUDENT promotion).
 *
 * No DB, no network — everything provider-agnostic is exercised.
 */

import { ContractsService } from './contracts.service';
import { DocusealService } from './docuseal.service';

const D = new Date('2026-07-22T09:00:00.000Z');

function makeMocks() {
  // captured writes for assertions
  const captured: any = {
    contractUpdate: null,
    caseVisaUpdate: null,
    invoiceCreate: null,
    userRolePromotion: null,
    signerUpdates: [] as any[],
    documentCreate: null,
    r2Put: null,
  };

  const contract = {
    id: 'ctr1',
    caseId: 'case1',
    status: 'SENT',
    signers: [
      { id: 's1', role: 'CLIENT', signerEmail: 'client@x.com', status: 'SENT', signedAt: null, viewedAt: null },
      { id: 's2', role: 'LIA', signerEmail: 'lia@x.com', status: 'PENDING', signedAt: null, viewedAt: null },
      { id: 's3', role: 'DIRECTOR', signerEmail: 'dir@x.com', status: 'PENDING', signedAt: null, viewedAt: null },
    ],
  };

  const prisma: any = {
    contract: {
      findFirst: jest.fn().mockResolvedValue(contract),
      update: jest.fn(async (args: any) => { captured.contractUpdate = args.data; return {}; }),
    },
    contractSigner: {
      update: jest.fn(async (args: any) => { captured.signerUpdates.push(args); return {}; }),
      findMany: jest.fn(async (args: any) => {
        const roles: string[] = args?.where?.role?.in ?? [];
        // maybePromote asks for CLIENT/GUARDIAN/LIA; invoice asks CLIENT/GUARDIAN
        if (roles.includes('LIA')) {
          return [
            { role: 'CLIENT', signedAt: D },
            { role: 'LIA', signedAt: D },
          ];
        }
        return [{ signedAt: D }];
      }),
    },
    case: {
      findUnique: jest.fn(async (args: any) => {
        const sel = args?.select ?? {};
        if (sel.visaType) return { visaType: null };
        if (sel.liaId || sel.ownerId) return { liaId: 'lia-user', ownerId: null };
        if (sel.lead?.select?.contact) return { lead: { contact: { userId: 'user1' } } };
        if (sel.lead?.select?.contactId) return { lead: { contactId: 'contact1' } };
        return {};
      }),
      update: jest.fn(async (args: any) => { captured.caseVisaUpdate = args.data; return {}; }),
    },
    document: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async (args: any) => { captured.documentCreate = args.data; return { id: 'doc1' }; }),
    },
    invoice: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async (args: any) => { captured.invoiceCreate = args.data; return { id: 'inv1' }; }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'user1', role: 'LEAD' }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (cb: any) =>
      cb({
        user: { update: jest.fn(async (args: any) => { captured.userRolePromotion = args.data; return {}; }) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      }),
    ),
  };

  const r2: any = { putObject: jest.fn(async (...a: any[]) => { captured.r2Put = a[0]; }) };
  const liaAssignments: any = {
    assignLiaToCase: jest.fn().mockResolvedValue({ status: 'already_assigned', liaId: 'lia-user' }),
    assignAdmissionToCase: jest.fn().mockResolvedValue({ status: 'skipped' }),
    assignFinanceToCase: jest.fn().mockResolvedValue({ status: 'skipped' }),
  };

  // Real DocusealService — only the network methods stubbed; extractVisaType is real.
  const docuseal = new DocusealService();
  jest.spyOn(docuseal, 'getSubmission').mockResolvedValue({
    id: 1,
    status: 'completed',
    completed_at: D.toISOString(),
    submitters: [
      { email: 'client@x.com', status: 'completed', completed_at: D.toISOString(), values: [] },
      {
        email: 'lia@x.com',
        role: 'LIA',
        status: 'completed',
        completed_at: D.toISOString(),
        values: [
          { field: 'Full Name', value: 'Sheila' },
          { field: 'Initial Student Visa', value: true },
        ],
      },
      { email: 'dir@x.com', status: 'completed', completed_at: D.toISOString(), values: [] },
    ],
  });
  jest.spyOn(docuseal, 'downloadCompletedPdf').mockResolvedValue(Buffer.from('%PDF-1.4 test'));

  // PR-CONTRACT-LEAD (Phase B) — CasesService is now injected for lead-based
  // case auto-creation. This harness's contract has a caseId already, so the
  // lead-based branch never fires and createCase is never called.
  const cases: any = { createCase: jest.fn() };

  const service = new ContractsService(
    prisma,
    {} as any, // DocuSignService — unused on the DocuSeal path
    {} as any, // MailService — unused here
    liaAssignments,
    r2,
    docuseal,
    cases,
  );

  return { service, prisma, captured, docuseal, cases };
}

describe('handleDocusealWebhook (submission.completed)', () => {
  it('marks SIGNED, captures visaType, stores the PDF, and runs both downstream steps', async () => {
    const { service, captured, prisma } = makeMocks();

    const result = await service.handleDocusealWebhook({
      event_type: 'submission.completed',
      data: { id: 1 },
    });

    // resolved the contract by submission id
    expect(prisma.contract.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { docusealSubmissionId: '1' } }),
    );
    // contract → SIGNED
    expect(captured.contractUpdate?.status).toBe('SIGNED');
    expect(captured.contractUpdate?.signedAt).toBeInstanceOf(Date);
    // visaType captured from the checked LIA checkbox
    expect(captured.caseVisaUpdate?.visaType).toBe('Initial Student Visa');
    // completed PDF stored as a Document (signed_contract) in R2
    expect(captured.r2Put).toMatch(/^signed-contracts\/case1\/1\.pdf$/);
    expect(captured.documentCreate?.category).toBe('signed_contract');
    // engagement invoice created
    expect(captured.invoiceCreate?.invoiceNumber).toBe('ENG-case1');
    expect(captured.invoiceCreate?.status).toBe('SENT');
    // LEAD → STUDENT promotion fired
    expect(captured.userRolePromotion?.role).toBe('STUDENT');
    // returned the contract (not null)
    expect(result).not.toBeNull();
  });

  it('no-ops gracefully when no contract matches the submission id', async () => {
    const { service, prisma } = makeMocks();
    prisma.contract.findFirst.mockResolvedValueOnce(null);

    const result = await service.handleDocusealWebhook({
      event_type: 'submission.completed',
      data: { id: 999 },
    });
    expect(result).toBeNull();
  });

  it('syncs signer rows but does NOT mark SIGNED when not all parties are completed', async () => {
    const { service, captured, docuseal } = makeMocks();
    (docuseal.getSubmission as jest.Mock).mockResolvedValueOnce({
      id: 1,
      status: 'pending',
      submitters: [
        { email: 'client@x.com', status: 'completed', completed_at: D.toISOString(), values: [] },
        { email: 'lia@x.com', status: 'awaiting', values: [] },
        { email: 'dir@x.com', status: 'awaiting', values: [] },
      ],
    });

    await service.handleDocusealWebhook({ event_type: 'form.completed', data: { submission_id: 1 } });

    // no SIGNED, no invoice, no promotion while the LIA + Director are pending
    expect(captured.contractUpdate).toBeNull();
    expect(captured.invoiceCreate).toBeNull();
    expect(captured.userRolePromotion).toBeNull();
  });
});
