/**
 * PR-COMPLIANCE — ComplianceService: flagged-cases list + the LIA-routing
 * pass/fail check + the override audit slice. DB-backed (real Prisma, throwaway DB).
 *
 * LIA-routing check under test: a red-flagged lead (liaEscalationRequired) is
 * routing-compliant only if — for any contract sent on its case — an APPROVED LIA
 * decision was recorded BEFORE the contract was sent. No contract yet = compliant;
 * contract without a prior approval = BREACH.
 */

import { PrismaClient } from '@prisma/client';
import { ComplianceService } from './compliance.service';

jest.setTimeout(60000);

describe('ComplianceService', () => {
  let prisma: PrismaClient;
  let svc: ComplianceService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    svc = new ComplianceService(prisma as any);
  }, 60000);

  afterAll(async () => { await prisma.$disconnect(); });

  let seq = 0;
  const stamp = () => `cp${Date.now()}_${(seq += 1)}`;

  async function seedLead(opts: { hardStop?: boolean; redFlag?: boolean }) {
    const s = stamp();
    const contact = await prisma.contact.create({ data: { fullName: `Client ${s}`, email: `c.${s}@t.local` } });
    return prisma.lead.create({
      data: {
        contactId: contact.id, leadStatus: 'NEW',
        hardStopFlag: opts.hardStop ?? false,
        liaEscalationRequired: opts.redFlag ?? false,
      },
    });
  }
  async function seedCaseWithContract(leadId: string) {
    const kase = await prisma.case.create({ data: { leadId } });
    await prisma.contract.create({ data: { caseId: kase.id, status: 'SENT' } });
    return kase;
  }
  async function seedApprovedLia(leadId: string, decidedAt: Date) {
    await prisma.consultation.create({
      data: { leadId, type: 'LIA', status: 'COMPLETED', decision: 'APPROVED', decidedAt, amountNZD: 0 } as any,
    });
  }

  it('flagged-cases: status + LIA-routing verdict across the matrix', async () => {
    const hs = await seedLead({ hardStop: true });                    // hard stop only
    const pending = await seedLead({ redFlag: true });                // red flag, no contract
    const breach = await seedLead({ redFlag: true });                 // red flag, contract, NO approval
    const ordered = await seedLead({ redFlag: true });                // red flag, approval BEFORE contract
    const cleared = await seedLead({ hardStop: false, redFlag: false }); // not flagged

    await seedCaseWithContract(breach.id);
    await seedApprovedLia(ordered.id, new Date('2026-01-01T00:00:00Z')); // well before "now"
    await seedCaseWithContract(ordered.id);

    const all = await svc.listFlaggedCases();
    const by = (id: string) => all.find((r) => r.leadId === id);

    // cleared lead is NOT in the flagged list
    expect(by(cleared.id)).toBeUndefined();

    // hard stop → status HARD_STOP, routing N/A
    expect(by(hs.id)!.status).toBe('HARD_STOP');
    expect(by(hs.id)!.routingCompliance).toBe('NOT_APPLICABLE');

    // red-flagged, no contract yet → AWAITING_LIA, compliant (pending review)
    expect(by(pending.id)!.status).toBe('AWAITING_LIA');
    expect(by(pending.id)!.contractSent).toBe(false);
    expect(by(pending.id)!.routingCompliance).toBe('COMPLIANT');

    // red-flagged, contract sent, NO approval → BREACH
    expect(by(breach.id)!.contractSent).toBe(true);
    expect(by(breach.id)!.routingCompliance).toBe('BREACH');

    // red-flagged, APPROVED before the contract → COMPLIANT
    expect(by(ordered.id)!.liaApproved).toBe(true);
    expect(by(ordered.id)!.contractSent).toBe(true);
    expect(by(ordered.id)!.routingCompliance).toBe('COMPLIANT');
  });

  it('override-log: surfaces override event types only, newest first', async () => {
    const s = stamp();
    const override = await prisma.auditLog.create({
      data: { userId: null, action: 'UPDATE', eventType: 'LIA_HARD_STOP_CLEARED', entityType: 'CASE', entityId: `case-${s}`, actorNameSnapshot: 'Tester', actorRoleSnapshot: 'LIA' },
    });
    const nonOverride = await prisma.auditLog.create({
      data: { userId: null, action: 'CREATE', eventType: 'TICKET_CREATED', entityType: 'TICKET', entityId: `t-${s}` },
    });

    const rows = await svc.listOverrideAuditLog(200);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(override.id);       // override event surfaced
    expect(ids).not.toContain(nonOverride.id); // non-override filtered out
    expect(rows.find((r) => r.id === override.id)!.actorName).toBe('Tester');
  });
});
