/**
 * PR-COMMISSIONS-UI — CommissionsService lifecycle + reminder + gating. DB-backed.
 * The business logic is reused as-is; this pins the create → confirm → invoice →
 * pay flow, the renewal-reminder set on confirm, invalid-transition rejection, and
 * the OWNER/FINANCE(+SUPER_ADMIN) gating on confirm / view / reminder.
 */

import { PrismaClient } from '@prisma/client';
import { CommissionsService } from './commissions.service';
import { ForbiddenException, BadRequestException } from '@nestjs/common';

jest.setTimeout(60000);

describe('CommissionsService (institutional/provider commissions)', () => {
  let prisma: PrismaClient;
  let svc: CommissionsService;
  const events = { emit: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    svc = new CommissionsService(prisma as any, events as any);
  }, 60000);

  afterAll(async () => { await prisma.$disconnect(); });

  let seq = 0;
  const stamp = () => `cm${Date.now()}_${(seq += 1)}`;

  // Seed provider + programme + case + application → returns the ids createCommission needs.
  async function seedApplication() {
    const s = stamp();
    const provider = await prisma.educationProvider.create({ data: { name: `Provider ${s}`, providerType: 'UNIVERSITY' } as any });
    const programme = await prisma.educationProgramme.create({ data: { name: `Programme ${s}`, providerId: provider.id, level: 'DIPLOMA', nzqfLevel: 'LEVEL_5' } as any });
    const contact = await prisma.contact.create({ data: { fullName: `Student ${s}`, email: `s.${s}@t.local` } });
    const lead = await prisma.lead.create({ data: { contactId: contact.id, leadStatus: 'EXECUTING' } as any });
    const kase = await prisma.case.create({ data: { leadId: lead.id } });
    const app = await prisma.application.create({ data: { caseId: kase.id, providerId: provider.id, programmeId: programme.id } as any });
    return { applicationId: app.id, providerId: provider.id, programmeId: programme.id, studentName: `Student ${s}` };
  }

  async function recordEstimated() {
    const seed = await seedApplication();
    const c = await svc.createCommission({
      applicationId: seed.applicationId, providerId: seed.providerId, programmeId: seed.programmeId,
      commissionType: 'PERCENTAGE' as any, commissionValue: 15, estimatedAmountNZD: 3000,
    } as any);
    return { ...seed, commission: c };
  }

  it('lifecycle: create (ESTIMATED) → confirm (+renewal reminder) → invoiced → paid', async () => {
    const { commission } = await recordEstimated();
    expect(commission.status).toBe('ESTIMATED');

    const confirmed = await svc.confirmCommission(commission.id, 'owner-1', 'OWNER');
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.confirmedAt).not.toBeNull();
    // Renewal reminder is set to ~1 year after confirmation.
    expect(confirmed.renewalReminderDate).not.toBeNull();
    const gapDays = (confirmed.renewalReminderDate!.getTime() - confirmed.confirmedAt!.getTime()) / 86_400_000;
    expect(gapDays).toBeGreaterThan(360);
    expect(gapDays).toBeLessThan(370);

    const invoiced = await svc.updateStatus(commission.id, { status: 'INVOICED' as any });
    expect(invoiced.status).toBe('INVOICED');
    expect(invoiced.invoiceSentAt).not.toBeNull();

    const paid = await svc.updateStatus(commission.id, { status: 'PAID' as any });
    expect(paid.status).toBe('PAID');
    expect(paid.paidAt).not.toBeNull();
  });

  it('rejects an invalid status transition (ESTIMATED → PAID)', async () => {
    const { commission } = await recordEstimated();
    await expect(svc.updateStatus(commission.id, { status: 'PAID' as any })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gating: OWNER + FINANCE can confirm; other roles cannot', async () => {
    const a = await recordEstimated();
    await expect(svc.confirmCommission(a.commission.id, null, 'CONSULTANT')).rejects.toBeInstanceOf(ForbiddenException);
    // FINANCE is allowed (fresh commission).
    const b = await recordEstimated();
    const okFinance = await svc.confirmCommission(b.commission.id, 'fin-1', 'FINANCE');
    expect(okFinance.status).toBe('CONFIRMED');
  });

  it('gating: only OWNER/SUPER_ADMIN/FINANCE may read the ledger', async () => {
    await recordEstimated();
    await expect(svc.findAll({}, { id: null, name: 'X', role: 'CONSULTANT' })).rejects.toBeInstanceOf(ForbiddenException);
    // id null → the ledger-view audit row is written with a null actor (no user FK).
    const rows = await svc.findAll({}, { id: null, name: 'Owner', role: 'OWNER' });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    // Client-safe includes resolve (student name reachable).
    expect(rows[0].provider).toBeTruthy();
  });

  it('reminder gating: FINANCE may update a reminder date; a non-money role cannot', async () => {
    const { commission } = await recordEstimated();
    await expect(svc.updateReminderDate(commission.id, { renewalReminderDate: new Date('2027-01-01').toISOString() } as any, 'CONSULTANT'))
      .rejects.toBeInstanceOf(ForbiddenException);
    const updated = await svc.updateReminderDate(commission.id, { renewalReminderDate: new Date('2027-01-01').toISOString() } as any, 'FINANCE');
    expect(updated.renewalReminderDate).not.toBeNull();
  });
});
