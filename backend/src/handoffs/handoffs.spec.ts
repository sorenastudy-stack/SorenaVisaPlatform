/**
 * PR-HANDOFFS — HandoffsService: staffing exceptions (reused from
 * OpsHandoffsService) + the three state-derived "stuck case" rules.
 * DB-backed (real Prisma, throwaway DB).
 *
 * Staffing exceptions verified: LIA/Admission/Finance missing after a signed
 * contract, and Pastoral missing after visa approval, both surface in
 * staffing.rows. Stuck rules verified: signed + engagement-PAID case still in
 * ADMISSION, and visa-approved case with no pastoral, both surface in `stuck`;
 * a signed-but-UNPAID admission case and a recent INZ submission do NOT.
 */

import { PrismaClient } from '@prisma/client';
import { HandoffsService } from './handoffs.service';
import { OpsHandoffsService } from '../ops-handoffs/ops-handoffs.service';

jest.setTimeout(60000);

describe('HandoffsService', () => {
  let prisma: PrismaClient;
  let svc: HandoffsService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    svc = new HandoffsService(prisma as any, new OpsHandoffsService(prisma as any));
  }, 60000);

  afterAll(async () => { await prisma.$disconnect(); });

  let seq = 0;
  const stamp = () => `hf${Date.now()}_${(seq += 1)}`;

  async function seedCase(): Promise<string> {
    const s = stamp();
    const contact = await prisma.contact.create({ data: { fullName: `Client ${s}`, email: `c.${s}@t.local` } });
    const lead = await prisma.lead.create({ data: { contactId: contact.id, leadStatus: 'NEW' } as any });
    const kase = await prisma.case.create({ data: { leadId: lead.id } });
    return kase.id;
  }
  async function signContract(caseId: string) {
    await prisma.contract.create({ data: { caseId, status: 'SENT', signedAt: new Date('2026-02-01T00:00:00Z') } as any });
  }
  async function engInvoice(caseId: string, status: 'PAID' | 'SENT') {
    const s = stamp();
    const contact = await prisma.contact.create({ data: { fullName: `Payer ${s}`, email: `p.${s}@t.local` } });
    await prisma.invoice.create({ data: { caseId, contactId: contact.id, invoiceNumber: `ENG-${caseId}`, amount: 200, status, description: 'Engagement fee' } as any });
  }
  async function issuer(): Promise<string> {
    const s = stamp();
    const u = await prisma.user.create({ data: { name: `Issuer ${s}`, email: `i.${s}@t.local`, passwordHash: 'x', role: 'LIA' as any, isActive: true } });
    return u.id;
  }
  async function approveVisa(caseId: string, issuedById: string) {
    await prisma.visa.create({ data: { caseId, outcome: 'APPROVED', issuedById, issuedAt: new Date('2026-03-01T00:00:00Z') } as any });
  }

  it('staffing exceptions: signed contract with empty LIA/Admission/Finance slots surfaces', async () => {
    const caseId = await seedCase();
    await signContract(caseId); // slots all null → all three "due but empty"

    const { staffing } = await svc.getHandoffs();
    const row = staffing.rows.find((r) => r.caseId === caseId);
    expect(row).toBeDefined();
    const slots = row!.missingSlots.map((m) => m.slot).sort();
    expect(slots).toEqual(['ADMISSION', 'FINANCE', 'LIA']);
  });

  it('staffing exceptions: visa approved with no support surfaces a PASTORAL slot', async () => {
    const caseId = await seedCase();
    await approveVisa(caseId, await issuer()); // supportId null + visa APPROVED

    const { staffing } = await svc.getHandoffs();
    const row = staffing.rows.find((r) => r.caseId === caseId);
    expect(row).toBeDefined();
    expect(row!.missingSlots.some((m) => m.slot === 'PASTORAL')).toBe(true);
  });

  it('stuck rule: contract signed + engagement invoice PAID but still in ADMISSION surfaces', async () => {
    const paidStuck = await seedCase();
    await signContract(paidStuck);
    await engInvoice(paidStuck, 'PAID'); // stage defaults to ADMISSION

    const unpaid = await seedCase();
    await signContract(unpaid);
    await engInvoice(unpaid, 'SENT'); // signed but NOT paid → must NOT surface

    const { stuck } = await svc.getHandoffs();
    const hit = stuck.find((r) => r.caseId === paidStuck && r.rule === 'SIGNED_PAID_STUCK_ADMISSION');
    expect(hit).toBeDefined();
    expect(stuck.some((r) => r.caseId === unpaid)).toBe(false);
  });

  it('stuck rule: visa approved with no pastoral support surfaces', async () => {
    const caseId = await seedCase();
    await approveVisa(caseId, await issuer());

    const { stuck } = await svc.getHandoffs();
    expect(stuck.some((r) => r.caseId === caseId && r.rule === 'VISA_APPROVED_NO_PASTORAL')).toBe(true);
  });

  it('stuck rule: INZ_SUBMITTED older than the threshold surfaces; a recent one does not', async () => {
    const aged = await seedCase();
    await prisma.case.update({
      where: { id: aged },
      data: { stage: 'INZ_SUBMITTED', inzSubmittedAt: new Date('2026-01-01T00:00:00Z') }, // ~old relative to any "now"
    });
    const recent = await seedCase();
    await prisma.case.update({
      where: { id: recent },
      data: { stage: 'INZ_SUBMITTED', inzSubmittedAt: new Date() }, // just now → not aged
    });

    const { stuck, inzAgeThresholdDays } = await svc.getHandoffs();
    expect(inzAgeThresholdDays).toBeGreaterThan(0);
    expect(stuck.some((r) => r.caseId === aged && r.rule === 'INZ_SUBMITTED_AGED')).toBe(true);
    expect(stuck.some((r) => r.caseId === recent)).toBe(false);
  });
});
