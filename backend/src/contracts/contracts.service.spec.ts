/**
 * PR-DOCUSIGN-1 step 5 piece 3 — ContractsService.handleWebhook spec.
 *
 * Real PrismaClient + per-test fixtures (mirrors the Phase-7 +
 * lia-profiles spec patterns). DocuSignService / LiaAssignmentService
 * / NotificationsService are mocked because we don't want to hit
 * DocuSign demo on every CI run and we want to drive specific
 * listRecipients/syncStatus shapes through the handler to exercise
 * the mapping + idempotency paths.
 *
 * Four tests:
 *   1. Unknown envelopeId — graceful no-op (returns null, no SDK calls)
 *   2. CLIENT delivered → VIEWED + viewedAt; LIA + DIRECTOR untouched
 *   3. All recipients completed → all rows SIGNED, Contract.status SIGNED
 *   4. Duplicate webhook with identical data is idempotent (updatedAt
 *      does not move on the second call)
 */

import { Test } from '@nestjs/testing';
import {
  ContractSignerStatus,
  ContractStatus,
  PrismaClient,
} from '@prisma/client';
import { ContractsService } from './contracts.service';
import { DocuSignService } from './docusign.service';
import { DocusealService } from './docuseal.service';
import { LiaAssignmentService } from '../cases/lia-assignment.service';
import { MailService } from '../mail/mail.service';
import { R2Service } from '../common/r2/r2.service';
import { PrismaService } from '../prisma/prisma.service';

const TAG = '__pr_docusign_1_piece3__';

// ─── Seed / cleanup helpers ────────────────────────────────────────────────

interface SeededContract {
  liaUserId:  string;
  contactId:  string;
  leadId:     string;
  caseId:     string;
  contractId: string;
  envelopeId: string;
  signerIds:  { client: string; lia: string; director: string };
  stamp:      string;
}

async function seedContractWithSigners(
  prisma: PrismaClient,
): Promise<SeededContract> {
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const envelopeId = `test-envelope-${stamp}`;

  const liaUser = await prisma.user.create({
    data: {
      name:         `Test LIA ${stamp}`,
      email:        `lia.${stamp}@${TAG}.test`,
      passwordHash: 'no-login',
      role:         'LIA',
      isActive:     true,
    },
  });

  const contact = await prisma.contact.create({
    data: {
      fullName: `Test Applicant ${stamp}`,
      email:    `applicant.${stamp}@${TAG}.test`,
    },
  });

  const lead = await prisma.lead.create({
    data: {
      contactId:        contact.id,
      executionAllowed: true,
      hardStopFlag:     false,
      leadStatus:       'NEW',
    },
  });

  // case.liaId pre-set so the existing at-sign trigger short-circuits
  // via 'already_assigned' (kept as a safety net per piece 2 design).
  const caseRow = await prisma.case.create({
    data: {
      leadId:        lead.id,
      stage:         'ADMISSION',
      status:        'active',
      riskLevel:     'LOW',
      liaId:         liaUser.id,
      liaAssignedAt: new Date(),
    },
  });

  const contract = await prisma.contract.create({
    data: {
      caseId:             caseRow.id,
      docusignEnvelopeId: envelopeId,
      status:             ContractStatus.SENT,
    },
  });

  // Initial signer state right after createContract: CLIENT just got
  // the email (SENT); LIA + DIRECTOR are queued (PENDING). Matches
  // what piece 2's createContract writes.
  const client = await prisma.contractSigner.create({
    data: {
      contractId:          contract.id,
      role:                'CLIENT',
      routingOrder:        1,
      signerName:          contact.fullName!,
      signerEmail:         contact.email!,
      docusignRecipientId: '1',
      status:              ContractSignerStatus.SENT,
    },
  });
  const lia = await prisma.contractSigner.create({
    data: {
      contractId:          contract.id,
      role:                'LIA',
      routingOrder:        2,
      signerName:          liaUser.name,
      signerEmail:         liaUser.email,
      userId:              liaUser.id,
      docusignRecipientId: '2',
      status:              ContractSignerStatus.PENDING,
    },
  });
  const director = await prisma.contractSigner.create({
    data: {
      contractId:          contract.id,
      role:                'DIRECTOR',
      routingOrder:        3,
      signerName:          `Test Director ${stamp}`,
      signerEmail:         `director.${stamp}@${TAG}.test`,
      docusignRecipientId: '3',
      status:              ContractSignerStatus.PENDING,
    },
  });

  return {
    liaUserId:  liaUser.id,
    contactId:  contact.id,
    leadId:     lead.id,
    caseId:     caseRow.id,
    contractId: contract.id,
    envelopeId,
    signerIds:  { client: client.id, lia: lia.id, director: director.id },
    stamp,
  };
}

async function cleanupContract(
  prisma: PrismaClient,
  ids: SeededContract,
): Promise<void> {
  // Reverse FK order. .catch on each so a partial-seed teardown
  // tolerates already-deleted rows.
  await prisma.auditLog.deleteMany({ where: { entityId: ids.caseId } });
  await prisma.contractSigner.deleteMany({ where: { contractId: ids.contractId } });
  await prisma.contract.delete({ where: { id: ids.contractId } }).catch(() => undefined);
  await prisma.case.delete({ where: { id: ids.caseId } }).catch(() => undefined);
  await prisma.lead.delete({ where: { id: ids.leadId } }).catch(() => undefined);
  await prisma.contact.delete({ where: { id: ids.contactId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: ids.liaUserId } }).catch(() => undefined);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('ContractsService.handleWebhook (PR-DOCUSIGN-1 step 5 piece 3)', () => {
  let prisma: PrismaClient;
  let service: ContractsService;

  // Mocks for the three external collaborators. Reset between tests
  // so each test sees a clean call history.
  let docuSignMock: {
    syncStatus:         jest.Mock;
    listRecipients:     jest.Mock;
    createEnvelope:     jest.Mock;
    getSigningUrl:      jest.Mock;
    getAccessToken:     jest.Mock;
    // PR-CONTRACT-CAPTURE — the SIGNED completion path pulls the flattened PDF +
    // visaType via these. The capture helpers are never-throw, but mock them so
    // the completion test runs cleanly instead of swallowing an error.
    getCombinedDocument: jest.Mock;
    getSelectedVisaType: jest.Mock;
  };
  let liaMock: { assignLiaToCase: jest.Mock; assignAdmissionToCase: jest.Mock; assignFinanceToCase: jest.Mock };
  // PR-DOCUSEAL — the ContractsService constructor swapped NotificationsService
  // for MailService / R2Service / DocusealService. These stubs satisfy DI; the
  // DocuSign handleWebhook path under test doesn't call DocusealService, and
  // MailService is unused in this service, so empty stubs are sufficient.
  let r2Mock: { putObject: jest.Mock };
  let mailMock: Record<string, never>;
  let docusealMock: Record<string, never>;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    docuSignMock = {
      syncStatus:          jest.fn(),
      listRecipients:      jest.fn(),
      createEnvelope:      jest.fn(),
      getSigningUrl:       jest.fn(),
      getAccessToken:      jest.fn(),
      getCombinedDocument: jest.fn().mockResolvedValue(Buffer.from('test-pdf')),
      getSelectedVisaType: jest.fn().mockResolvedValue(null),
    };
    liaMock = {
      // case.liaId is pre-set by the fixture, so a real call would
      // return 'already_assigned'. We mock to skip the actual DB
      // work of LiaAssignmentService.
      assignLiaToCase: jest.fn().mockResolvedValue({
        status: 'already_assigned',
        liaId:  'fake-lia',
        liaName: null,
      }),
      // Phase 3: Admission + Finance auto-assign fire alongside the LIA at the
      // same hooks. Mocked to no-op ('already_assigned') so these unit tests
      // don't exercise their DB paths.
      assignAdmissionToCase: jest.fn().mockResolvedValue({
        status: 'already_assigned', ownerId: 'fake-owner', ownerName: null, replacedStrayOwner: false,
      }),
      assignFinanceToCase: jest.fn().mockResolvedValue({
        status: 'already_assigned', financeId: 'fake-finance', financeName: null,
      }),
    };
    r2Mock = { putObject: jest.fn().mockResolvedValue(undefined) };
    mailMock = {};
    docusealMock = {};

    const moduleRef = await Test.createTestingModule({
      providers: [
        ContractsService,
        { provide: PrismaService,         useValue: prisma },
        { provide: DocuSignService,       useValue: docuSignMock },
        { provide: MailService,           useValue: mailMock },
        { provide: LiaAssignmentService,  useValue: liaMock },
        { provide: R2Service,             useValue: r2Mock },
        { provide: DocusealService,       useValue: docusealMock },
      ],
    }).compile();

    service = moduleRef.get(ContractsService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    docuSignMock.syncStatus.mockReset();
    docuSignMock.listRecipients.mockReset();
    liaMock.assignLiaToCase.mockClear();
  });

  // ─── Test 1 — Unknown envelopeId ────────────────────────────────────────

  describe('test 1: unknown envelopeId — graceful no-op', () => {
    it('returns null, no SDK calls, no DB writes', async () => {
      const fakeEnvelopeId = `nonexistent-envelope-${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const result = await service.handleWebhook(fakeEnvelopeId);
      expect(result).toBeNull();
      expect(docuSignMock.syncStatus).not.toHaveBeenCalled();
      expect(docuSignMock.listRecipients).not.toHaveBeenCalled();
      expect(liaMock.assignLiaToCase).not.toHaveBeenCalled();
    });
  });

  // ─── Test 2 — CLIENT delivered → VIEWED ─────────────────────────────────

  describe('test 2: CLIENT delivered → VIEWED + viewedAt; others unchanged', () => {
    let ids: SeededContract;
    beforeEach(async () => { ids = await seedContractWithSigners(prisma); });
    afterEach(async () => { await cleanupContract(prisma, ids); });

    it('updates only the CLIENT row', async () => {
      const viewedIso = '2026-06-03T15:00:00.000Z';
      docuSignMock.syncStatus.mockResolvedValue({
        status:        'sent',
        signedAt:      null,
        declinedAt:    null,
        expiredAt:     null,
        signedFileUrl: null,
        auditTrailUrl: null,
      });
      docuSignMock.listRecipients.mockResolvedValue({
        signers: [
          { recipientId: '1', status: 'delivered', deliveredDateTime: viewedIso },
          { recipientId: '2', status: 'created' },
          { recipientId: '3', status: 'created' },
        ],
      });

      await service.handleWebhook(ids.envelopeId);

      const client = await prisma.contractSigner.findUnique({ where: { id: ids.signerIds.client } });
      expect(client?.status).toBe(ContractSignerStatus.VIEWED);
      expect(client?.viewedAt?.toISOString()).toBe(new Date(viewedIso).toISOString());
      expect(client?.signedAt).toBeNull();
      expect(client?.declinedAt).toBeNull();

      const lia = await prisma.contractSigner.findUnique({ where: { id: ids.signerIds.lia } });
      expect(lia?.status).toBe(ContractSignerStatus.PENDING);
      expect(lia?.viewedAt).toBeNull();

      const director = await prisma.contractSigner.findUnique({ where: { id: ids.signerIds.director } });
      expect(director?.status).toBe(ContractSignerStatus.PENDING);
      expect(director?.viewedAt).toBeNull();
    });
  });

  // ─── Test 3 — All recipients completed → SIGNED ────────────────────────

  describe('test 3: all recipients completed → all rows SIGNED + Contract.status SIGNED', () => {
    let ids: SeededContract;
    beforeEach(async () => { ids = await seedContractWithSigners(prisma); });
    afterEach(async () => { await cleanupContract(prisma, ids); });

    it('per-row signedAt set; Contract.signedAt + signedFileUrl + auditTrailUrl set', async () => {
      const t1 = '2026-06-03T15:00:00.000Z';
      const t2 = '2026-06-03T15:10:00.000Z';
      const t3 = '2026-06-03T15:20:00.000Z';
      docuSignMock.syncStatus.mockResolvedValue({
        status:        'completed',
        signedAt:      t3,
        declinedAt:    null,
        expiredAt:     null,
        signedFileUrl: 'https://demo.docusign.net/documents/test-signed',
        auditTrailUrl: 'https://demo.docusign.net/certificate/test-audit',
      });
      docuSignMock.listRecipients.mockResolvedValue({
        signers: [
          { recipientId: '1', status: 'completed', deliveredDateTime: t1, signedDateTime: t1 },
          { recipientId: '2', status: 'completed', deliveredDateTime: t2, signedDateTime: t2 },
          { recipientId: '3', status: 'completed', deliveredDateTime: t3, signedDateTime: t3 },
        ],
      });

      await service.handleWebhook(ids.envelopeId);

      const signers = await prisma.contractSigner.findMany({
        where: { contractId: ids.contractId },
        orderBy: { routingOrder: 'asc' },
      });
      expect(signers).toHaveLength(3);
      for (const s of signers) {
        expect(s.status).toBe(ContractSignerStatus.SIGNED);
        expect(s.signedAt).not.toBeNull();
      }
      expect(signers[0].signedAt?.toISOString()).toBe(new Date(t1).toISOString());
      expect(signers[1].signedAt?.toISOString()).toBe(new Date(t2).toISOString());
      expect(signers[2].signedAt?.toISOString()).toBe(new Date(t3).toISOString());

      const contract = await prisma.contract.findUnique({ where: { id: ids.contractId } });
      expect(contract?.status).toBe(ContractStatus.SIGNED);
      expect(contract?.signedAt?.toISOString()).toBe(new Date(t3).toISOString());
      expect(contract?.signedFileUrl).toBe('https://demo.docusign.net/documents/test-signed');
      expect(contract?.auditTrailUrl).toBe('https://demo.docusign.net/certificate/test-audit');

      // The existing at-sign trigger fires once (idempotent safety
      // net per piece 2). case.liaId was pre-set by the fixture so
      // the real LiaAssignmentService would return 'already_assigned',
      // matching what our mock returns.
      expect(liaMock.assignLiaToCase).toHaveBeenCalledTimes(1);
      expect(liaMock.assignLiaToCase).toHaveBeenCalledWith(ids.caseId);
    });
  });

  // ─── Test 4 — Idempotency ───────────────────────────────────────────────

  describe('test 4: duplicate webhook is idempotent (no second write)', () => {
    let ids: SeededContract;
    beforeEach(async () => { ids = await seedContractWithSigners(prisma); });
    afterEach(async () => { await cleanupContract(prisma, ids); });

    it("second call with the same listRecipients data does NOT move updatedAt on any row", async () => {
      const viewedIso = '2026-06-03T15:00:00.000Z';
      docuSignMock.syncStatus.mockResolvedValue({
        status:        'sent',
        signedAt:      null,
        declinedAt:    null,
        expiredAt:     null,
        signedFileUrl: null,
        auditTrailUrl: null,
      });
      docuSignMock.listRecipients.mockResolvedValue({
        signers: [
          { recipientId: '1', status: 'delivered', deliveredDateTime: viewedIso },
          { recipientId: '2', status: 'created' },
          { recipientId: '3', status: 'created' },
        ],
      });

      // First call — mutates the CLIENT row.
      await service.handleWebhook(ids.envelopeId);
      const after1 = await prisma.contractSigner.findUnique({ where: { id: ids.signerIds.client } });
      expect(after1?.status).toBe(ContractSignerStatus.VIEWED);
      const updatedAt1 = after1!.updatedAt;
      const contract1 = await prisma.contract.findUnique({ where: { id: ids.contractId } });
      const contractUpdatedAt1 = contract1!.updatedAt;

      // Small wait so updatedAt would differ if a write happened
      // (Postgres TIMESTAMP(3) resolution is 1 ms — 50 ms is safely
      // distinguishable).
      await new Promise((r) => setTimeout(r, 50));

      // Second call — same SDK responses; should be a pure no-op.
      await service.handleWebhook(ids.envelopeId);
      const after2 = await prisma.contractSigner.findUnique({ where: { id: ids.signerIds.client } });
      expect(after2!.updatedAt.getTime()).toBe(updatedAt1.getTime());
      const contract2 = await prisma.contract.findUnique({ where: { id: ids.contractId } });
      expect(contract2!.updatedAt.getTime()).toBe(contractUpdatedAt1.getTime());

      // The mock SDK was hit twice, but DB row updatedAt held —
      // proves the "only-update-if-changed" predicate is the
      // idempotency lock.
      expect(docuSignMock.syncStatus).toHaveBeenCalledTimes(2);
      expect(docuSignMock.listRecipients).toHaveBeenCalledTimes(2);
    });
  });
});
