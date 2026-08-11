/**
 * PR-CO-KANBAN — the CO manual override (NurtureService.manualOverride) + the
 * kanban scoping + the staff raise-ticket. DB-backed (real Prisma).
 * Covers: ADVANCE ends nurture + audits; POSTPONE holds + audits + the sweep
 * actually skips the held lead until nurtureHeldUntil; a staff ticket is created
 * with the right department; and the kanban shows only the CO's own clients
 * (admin sees all) with the correct editable/read-only split.
 */

import { PrismaClient } from '@prisma/client';
import { NurtureService } from '../nurture/nurture.service';
import { KanbanService } from './kanban.service';
import { SlaService } from '../sla/sla.service';

jest.setTimeout(60000);

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const mail: any = { sendNurtureSequenceEmail: jest.fn().mockResolvedValue(true), sendNurtureNewsletter: jest.fn().mockResolvedValue(true) };

// The sequence sender is gated off in production until its placeholder copy is
// written (NURTURE_SWEEP_ENABLED). These suites exercise the sweep's real
// behaviour, so they arm it explicitly rather than asserting the disarmed path —
// which has its own suite in nurture-disarmed.spec.ts.
process.env.NURTURE_SWEEP_ENABLED = 'true';

describe('CO kanban — override, sweep-skip, tickets, scoping', () => {
  let prisma: PrismaClient;
  let nurture: NurtureService;
  let kanban: KanbanService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    nurture = new NurtureService(prisma as any, mail);
    kanban = new KanbanService(prisma as any, new SlaService(prisma as any));
  }, 60000);

  afterAll(async () => { await prisma.$disconnect(); });

  let seq = 0;
  const stamp = () => `ck${Date.now()}_${(seq += 1)}`;

  async function mkOfficer(): Promise<string> {
    const s = stamp();
    const u = await prisma.user.create({ data: { name: `CO ${s}`, email: `co.${s}@t.local`, passwordHash: 'x', role: 'CLIENT_CONSULTANT' as any, isActive: true } });
    return u.id;
  }
  // A pre-contract lead with a completed FREE_15 run by `coId`, enrolled in nurture.
  async function seedNurtureLead(coId: string) {
    const s = stamp();
    const contact = await prisma.contact.create({ data: { fullName: `Client ${s}`, email: `c.${s}@t.local` } });
    const lead = await prisma.lead.create({ data: { contactId: contact.id, leadStatus: 'NEW' } as any });
    await prisma.consultation.create({ data: { leadId: lead.id, type: 'FREE_15', status: 'COMPLETED', assignedToId: coId, amountNZD: 0, createdAt: new Date('2025-12-01') } as any });
    await nurture.enroll(lead.id, 'not ready', { userId: coId, role: 'CLIENT_CONSULTANT' });
    // pin the schedule start so the sweep is deterministic
    await prisma.lead.update({ where: { id: lead.id }, data: { nurtureStartedAt: new Date('2026-01-01') } });
    return { leadId: lead.id, contactId: contact.id };
  }
  const auditFor = (leadId: string, eventType: string) =>
    prisma.auditLog.findFirst({ where: { entityId: leadId, eventType }, orderBy: { createdAt: 'desc' } });

  it('ADVANCE ends nurturing + writes an audit row with the reason', async () => {
    const co = await mkOfficer();
    const { leadId } = await seedNurtureLead(co);

    await nurture.manualOverride(leadId, 'ADVANCE', 'client is ready now', null, { userId: co, role: 'CLIENT_CONSULTANT', name: 'CO' });

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead!.nurtureStage).toBe('ENDED');
    const audit = await auditFor(leadId, 'NURTURE_MANUALLY_ADVANCED');
    expect(audit).toBeTruthy();
    expect((audit!.newValue as any).reason).toBe('client is ready now');
  });

  it('POSTPONE holds the lead + audits, and the sweep SKIPS it until nurtureHeldUntil', async () => {
    const co = await mkOfficer();
    const { leadId } = await seedNurtureLead(co);

    // Postpone 10 days from a fixed "now".
    const now = new Date('2026-01-05T00:00:00Z');
    await nurture.manualOverride(leadId, 'POSTPONE', 'needs more review', 10, { userId: co, role: 'CLIENT_CONSULTANT', name: 'CO' }, now);

    const held = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(held!.nurtureHeldUntil).not.toBeNull();
    expect(held!.nurtureStage).toBe('SEQUENCE'); // still nurturing, just paused
    const audit = await auditFor(leadId, 'NURTURE_MANUALLY_POSTPONED');
    expect((audit!.newValue as any).holdDays).toBe(10);

    // A sweep while held → this lead is not processed (no new email ledger rows).
    const before = await prisma.leadNurtureSent.count({ where: { leadId } });
    await nurture.runDailySweep(new Date('2026-01-10T00:00:00Z')); // still within the hold (until ~01-15)
    const during = await prisma.leadNurtureSent.count({ where: { leadId } });
    expect(during).toBe(before);

    // Once the hold passes, the sweep processes it again (due emails send).
    await nurture.runDailySweep(new Date('2026-01-20T00:00:00Z')); // past hold + several due steps
    const after = await prisma.leadNurtureSent.count({ where: { leadId } });
    expect(after).toBeGreaterThan(before);
  });

  it('override is rejected once a contract exists (pre-contract only), and needs a reason', async () => {
    const co = await mkOfficer();
    const { leadId } = await seedNurtureLead(co);
    await expect(nurture.manualOverride(leadId, 'ADVANCE', '   ', null, { userId: co, role: 'CLIENT_CONSULTANT' })).rejects.toBeDefined();
    await prisma.contract.create({ data: { leadId, status: 'SENT' } as any });
    await expect(nurture.manualOverride(leadId, 'ADVANCE', 'go', null, { userId: co, role: 'CLIENT_CONSULTANT' })).rejects.toBeDefined();
  });

  it('staff raise-ticket creates a department-routed ticket', async () => {
    const co = await mkOfficer();
    const { contactId } = await seedNurtureLead(co);
    const { id } = await kanban.createStaffTicket({ userId: co, role: 'CLIENT_CONSULTANT', name: 'CO' },
      { contactId, department: 'DOCUMENTS' as any, subject: 'Missing passport scan' });
    const ticket = await prisma.ticket.findUnique({ where: { id } });
    expect(ticket!.department).toBe('DOCUMENTS');
    expect(ticket!.contactId).toBe(contactId);
    expect(ticket!.status).toBe('OPEN');
  });

  it('kanban is scoped: a CO sees only their own clients; admin sees all; cases read-only', async () => {
    const coA = await mkOfficer();
    const coB = await mkOfficer();
    const a = await seedNurtureLead(coA);
    await seedNurtureLead(coB);

    const mineA = await kanban.getKanban({ userId: coA, role: 'CLIENT_CONSULTANT' });
    const nurCol = mineA.columns.find((c) => c.key === 'NURTURING')!;
    expect(nurCol.editable).toBe(true);
    expect(nurCol.cards.some((c) => c.id === a.leadId)).toBe(true);          // A sees their lead
    // Case columns are read-only.
    expect(mineA.columns.find((c) => c.key === 'ADMISSION')!.editable).toBe(false);

    const mineB = await kanban.getKanban({ userId: coB, role: 'CLIENT_CONSULTANT' });
    expect(mineB.columns.find((c) => c.key === 'NURTURING')!.cards.some((c) => c.id === a.leadId)).toBe(false); // B can't see A's

    const admin = await kanban.getKanban({ userId: 'x', role: 'OWNER' });
    expect(admin.columns.find((c) => c.key === 'NURTURING')!.cards.some((c) => c.id === a.leadId)).toBe(true);  // admin sees all
  });
});
