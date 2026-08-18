import { PrismaClient, ApplicationStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { ApplicationsService } from './applications.service';
import { PrismaService } from '../prisma/prisma.service';

// PR-APPSTATUS — proving the status actually moves, and moves for the right
// reasons.
//
// The bug was never a missing state machine. applications.service already had a
// correct forward-only transition map, timestamps and events — nothing called
// it. Every application sat at PREPARATION forever, so "how many visas
// approved" was zero by construction rather than by fact.
//
// These tests drive the SERVICE methods the real LIA endpoints now call, against
// a real database, and assert the three things that would let the bug come back:
// that status advances, that it cannot skip or reverse without the explicit
// correction path, and that every change leaves an audit row naming who did it
// and what it was before.

const prisma = new PrismaClient();
const events = { emit: jest.fn().mockResolvedValue(undefined) } as any;
const svc = new ApplicationsService(prisma as unknown as PrismaService, events);

const LIA = { id: '', role: 'LIA' };
const tag = () => 'APPSTATUS-' + randomBytes(4).toString('hex');

async function seedCaseWithApplication(status: ApplicationStatus) {
  const t = tag();
  const lia = await prisma.user.create({
    data: { name: `${t} lia`, email: `${t}-lia@test.local`, role: 'LIA', isActive: true },
    select: { id: true },
  });
  const contact = await prisma.contact.create({
    data: { fullName: `${t} client`, email: `${t}@test.local` }, select: { id: true },
  });
  const lead = await prisma.lead.create({ data: { contactId: contact.id }, select: { id: true } });
  const kase = await prisma.case.create({ data: { leadId: lead.id }, select: { id: true } });

  const provider = await prisma.educationProvider.create({
    data: { name: `${t} Institution`, providerType: 'UNIVERSITY' }, select: { id: true },
  });
  const programme = await prisma.educationProgramme.create({
    data: { providerId: provider.id, name: `${t} Programme`, level: 'BACHELOR', nzqfLevel: 'LEVEL_7' },
    select: { id: true },
  });
  const app = await prisma.application.create({
    data: { caseId: kase.id, providerId: provider.id, programmeId: programme.id, status },
    select: { id: true },
  });
  return { t, liaId: lia.id, contactId: contact.id, leadId: lead.id, caseId: kase.id, providerId: provider.id, appId: app.id };
}

async function cleanup(f: any) {
  await prisma.auditLog.deleteMany({ where: { entityId: f.appId } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { userId: f.liaId } }).catch(() => {});
  await prisma.application.deleteMany({ where: { caseId: f.caseId } }).catch(() => {});
  await prisma.educationProgramme.deleteMany({ where: { providerId: f.providerId } }).catch(() => {});
  await prisma.educationProvider.deleteMany({ where: { id: f.providerId } }).catch(() => {});
  await prisma.case.deleteMany({ where: { id: f.caseId } }).catch(() => {});
  await prisma.lead.deleteMany({ where: { id: f.leadId } }).catch(() => {});
  await prisma.contact.deleteMany({ where: { id: f.contactId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: f.liaId } }).catch(() => {});
}

const statusOf = (id: string) =>
  prisma.application.findUnique({ where: { id }, select: { status: true } }).then((r) => r!.status);

afterAll(async () => { await prisma.$disconnect(); });

describe('the status actually advances on real milestones', () => {
  it('INZ submission moves OFFER_ACCEPTED -> VISA_SUBMITTED and stamps the timestamp', async () => {
    const f = await seedCaseWithApplication(ApplicationStatus.OFFER_ACCEPTED);
    try {
      const r = await svc.advanceForCase(
        f.caseId, ApplicationStatus.OFFER_ACCEPTED, ApplicationStatus.VISA_SUBMITTED,
        'POST /cases/:id/inz-submission', { id: f.liaId, role: 'LIA' },
      );
      expect(r.advanced).toBe(1);
      expect(await statusOf(f.appId)).toBe('VISA_SUBMITTED');
      const row = await prisma.application.findUnique({ where: { id: f.appId }, select: { visaSubmittedAt: true } });
      expect(row!.visaSubmittedAt).toBeInstanceOf(Date);
    } finally { await cleanup(f); }
  });

  it('a visa outcome moves VISA_SUBMITTED -> VISA_APPROVED', async () => {
    const f = await seedCaseWithApplication(ApplicationStatus.VISA_SUBMITTED);
    try {
      const r = await svc.advanceForCase(
        f.caseId, ApplicationStatus.VISA_SUBMITTED, ApplicationStatus.VISA_APPROVED,
        'POST /cases/:id/visa/issue', { id: f.liaId, role: 'LIA' },
      );
      expect(r.advanced).toBe(1);
      expect(await statusOf(f.appId)).toBe('VISA_APPROVED');
    } finally { await cleanup(f); }
  });

  it('a declined visa is recorded as VISA_DECLINED, not left stuck', async () => {
    const f = await seedCaseWithApplication(ApplicationStatus.VISA_SUBMITTED);
    try {
      await svc.advanceForCase(
        f.caseId, ApplicationStatus.VISA_SUBMITTED, ApplicationStatus.VISA_DECLINED,
        'POST /cases/:id/visa/decline', { id: f.liaId, role: 'LIA' },
      );
      expect(await statusOf(f.appId)).toBe('VISA_DECLINED');
    } finally { await cleanup(f); }
  });
});

describe('it will not invent facts', () => {
  it('an application in the WRONG predecessor state is left alone', async () => {
    // The case reached a visa milestone, but this application never got an
    // offer. Advancing it would fabricate a history that did not happen.
    const f = await seedCaseWithApplication(ApplicationStatus.PREPARATION);
    try {
      const r = await svc.advanceForCase(
        f.caseId, ApplicationStatus.VISA_SUBMITTED, ApplicationStatus.VISA_APPROVED,
        'POST /cases/:id/visa/issue', { id: f.liaId, role: 'LIA' },
      );
      expect(r.advanced).toBe(0);
      expect(await statusOf(f.appId)).toBe('PREPARATION');
    } finally { await cleanup(f); }
  });

  it('only the matching application on a multi-programme case advances', async () => {
    // A student applies to several programmes and accepts one. Only the
    // accepted one proceeds to a visa; the others must not be dragged along.
    const f = await seedCaseWithApplication(ApplicationStatus.OFFER_ACCEPTED);
    try {
      const other = await prisma.application.create({
        data: { caseId: f.caseId, providerId: f.providerId, programmeId: (await prisma.educationProgramme.findFirst({ where: { providerId: f.providerId }, select: { id: true } }))!.id, status: ApplicationStatus.PREPARATION },
        select: { id: true },
      });
      const r = await svc.advanceForCase(
        f.caseId, ApplicationStatus.OFFER_ACCEPTED, ApplicationStatus.VISA_SUBMITTED,
        'POST /cases/:id/inz-submission', { id: f.liaId, role: 'LIA' },
      );
      expect(r.advanced).toBe(1);
      expect(await statusOf(f.appId)).toBe('VISA_SUBMITTED');
      expect(await statusOf(other.id)).toBe('PREPARATION');   // untouched
    } finally { await cleanup(f); }
  });

  it('an illegal jump is refused even through the case-driven path', async () => {
    // PREPARATION -> VISA_APPROVED is not in the transition map. The
    // case-driven path routes through the same validation the manual endpoint
    // uses, so it cannot become a way around it.
    const f = await seedCaseWithApplication(ApplicationStatus.PREPARATION);
    try {
      const r = await svc.advanceForCase(
        f.caseId, ApplicationStatus.PREPARATION, ApplicationStatus.VISA_APPROVED,
        'test', { id: f.liaId, role: 'LIA' },
      );
      expect(r.advanced).toBe(0);
      expect(await statusOf(f.appId)).toBe('PREPARATION');
    } finally { await cleanup(f); }
  });
});

describe('every change is auditable', () => {
  it('a forward transition writes an audit row with who, old and new', async () => {
    const f = await seedCaseWithApplication(ApplicationStatus.VISA_SUBMITTED);
    try {
      await svc.advanceForCase(
        f.caseId, ApplicationStatus.VISA_SUBMITTED, ApplicationStatus.VISA_APPROVED,
        'POST /cases/:id/visa/issue', { id: f.liaId, role: 'LIA' },
      );
      const audit = await prisma.auditLog.findFirst({
        where: { entityId: f.appId, eventType: 'APPLICATION_STATUS_ADVANCED' },
        select: { userId: true, oldValue: true, newValue: true, actorRoleSnapshot: true, createdAt: true },
      });
      expect(audit).toBeTruthy();
      expect(audit!.userId).toBe(f.liaId);                              // who
      expect((audit!.oldValue as any).status).toBe('VISA_SUBMITTED');   // from
      expect((audit!.newValue as any).status).toBe('VISA_APPROVED');    // to
      expect((audit!.newValue as any).trigger).toBe('POST /cases/:id/visa/issue');
      expect(audit!.actorRoleSnapshot).toBe('LIA');
      expect(audit!.createdAt).toBeInstanceOf(Date);                    // when
    } finally { await cleanup(f); }
  });

  it('a reversal is audited under a DIFFERENT event type than progress', async () => {
    // Reading the trail, an undo must never look like a step forward.
    const f = await seedCaseWithApplication(ApplicationStatus.VISA_APPROVED);
    try {
      const r = await svc.revertForCase(
        f.caseId, ApplicationStatus.VISA_APPROVED, ApplicationStatus.VISA_SUBMITTED,
        'POST /cases/:id/visa/revert', { id: f.liaId, role: 'LIA' },
      );
      expect(r.reverted).toBe(1);
      expect(await statusOf(f.appId)).toBe('VISA_SUBMITTED');

      const advanced = await prisma.auditLog.count({ where: { entityId: f.appId, eventType: 'APPLICATION_STATUS_ADVANCED' } });
      const reverted = await prisma.auditLog.count({ where: { entityId: f.appId, eventType: 'APPLICATION_STATUS_REVERTED' } });
      expect(reverted).toBe(1);
      expect(advanced).toBe(0);

      // and the timestamp the forward step set is cleared, leaving no ghost
      const row = await prisma.application.findUnique({ where: { id: f.appId }, select: { visaDecisionAt: true } });
      expect(row!.visaDecisionAt).toBeNull();
    } finally { await cleanup(f); }
  });
});

describe('the reporting question the bug made unanswerable', () => {
  it('counts VISA_APPROVED and returns a real number once a case gets there', async () => {
    const f = await seedCaseWithApplication(ApplicationStatus.VISA_SUBMITTED);
    try {
      const before = await prisma.application.count({ where: { id: f.appId, status: 'VISA_APPROVED' } });
      expect(before).toBe(0);

      await svc.advanceForCase(
        f.caseId, ApplicationStatus.VISA_SUBMITTED, ApplicationStatus.VISA_APPROVED,
        'POST /cases/:id/visa/issue', { id: f.liaId, role: 'LIA' },
      );

      const after = await prisma.application.count({ where: { id: f.appId, status: 'VISA_APPROVED' } });
      expect(after).toBe(1);   // not zero-by-definition any more
    } finally { await cleanup(f); }
  });
});
