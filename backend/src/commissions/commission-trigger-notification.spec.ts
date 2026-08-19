import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { CommissionTriggersService } from './commission-triggers.service';
import { CommissionsService } from './commissions.service';
import { NotificationsService } from '../notifications/notifications.service';

// PR-CHECKLIST item 5 — the Admission Specialist is actually told.
//
// The PENDING -> APPROVED lifecycle already existed and already persisted. What
// did not exist was anyone finding out a claim was waiting, which is the whole
// point of the checklist item.
//
// These tests assert on a REAL notification row written by a REAL submit()
// against the database — not on a spy, because a mock would prove only that a
// method was called, and the requirement is that a notification exists and stays
// unread until the claim is approved.

const prisma = new PrismaClient();
const events: any = { emit: jest.fn().mockResolvedValue(undefined) };
const svc = new CommissionTriggersService(
  prisma as any,
  new CommissionsService(prisma as any, events),
  new NotificationsService(prisma as any),
);

const t = () => 'COMMNOTIF-' + randomBytes(4).toString('hex');

async function seed() {
  const tag = t();
  const mk = (who: string, role: any) => prisma.user.create({
    data: { name: `${tag} ${who}`, email: `${tag.toLowerCase()}-${who}@test.local`, role, isActive: true },
    select: { id: true },
  });
  const consultant = await mk('consultant', 'CONSULTANT');   // the Admission Specialist
  const submitter = await mk('submitter', 'ADMIN');
  const contact = await prisma.contact.create({ data: { fullName: `${tag} client`, email: `${tag.toLowerCase()}@test.local` }, select: { id: true } });
  const lead = await prisma.lead.create({ data: { contactId: contact.id }, select: { id: true } });
  const kase = await prisma.case.create({ data: { leadId: lead.id, consultantId: consultant.id }, select: { id: true } });

  const provider = await prisma.educationProvider.create({ data: { name: `${tag} Inst`, providerType: 'UNIVERSITY' }, select: { id: true } });
  const programme = await prisma.educationProgramme.create({
    data: { providerId: provider.id, name: `${tag} Programme`, level: 'BACHELOR', nzqfLevel: 'LEVEL_7' }, select: { id: true },
  });
  const admission = await prisma.admissionApplication.create({ data: { caseId: kase.id, contactId: contact.id }, select: { id: true } });
  // Eligible: attendance confirmed well past the cutoff.
  const choice = await prisma.admissionProgrammeChoice.create({
    data: {
      admissionApplication: { connect: { id: admission.id } },
      programme: { connect: { id: programme.id } },
      intakeMonth: 2,
      intakeYear: 2027,
      priority: 1,
      firstClassAttendedAt: new Date(Date.now() - 400 * 24 * 3600 * 1000),
    },
    select: { id: true },
  });
  return { tag, consultantId: consultant.id, submitterId: submitter.id, contactId: contact.id, leadId: lead.id, caseId: kase.id, providerId: provider.id, admissionId: admission.id, choiceId: choice.id };
}

async function cleanup(f: any) {
  const d = (p: Promise<any>) => p.catch(() => {});
  await d(prisma.notification.deleteMany({ where: { userId: { in: [f.consultantId, f.submitterId] } } }));
  await d(prisma.commissionTrigger.deleteMany({ where: { programmeChoiceId: f.choiceId } }));
  await d(prisma.commission.deleteMany({ where: { programmeChoiceId: f.choiceId } }));
  await d(prisma.admissionProgrammeChoice.deleteMany({ where: { id: f.choiceId } }));
  await d(prisma.admissionApplication.deleteMany({ where: { id: f.admissionId } }));
  await d(prisma.educationProgramme.deleteMany({ where: { providerId: f.providerId } }));
  await d(prisma.educationProvider.deleteMany({ where: { id: f.providerId } }));
  await d(prisma.case.deleteMany({ where: { id: f.caseId } }));
  await d(prisma.lead.deleteMany({ where: { id: f.leadId } }));
  await d(prisma.contact.deleteMany({ where: { id: f.contactId } }));
  await d(prisma.user.deleteMany({ where: { id: { in: [f.consultantId, f.submitterId] } } }));
}

afterAll(async () => { await prisma.$disconnect(); });

describe('a pending commission claim notifies the Admission Specialist', () => {
  it('writes a real, unread notification addressed to the case consultant', async () => {
    const f = await seed();
    try {
      const before = await prisma.notification.count({ where: { userId: f.consultantId } });
      expect(before).toBe(0);

      await svc.submit(f.choiceId, { id: f.submitterId, role: 'ADMIN', secondaryRoles: [] } as any);

      const notes = await prisma.notification.findMany({
        where: { userId: f.consultantId, type: 'COMMISSION_TRIGGER_PENDING' },
        select: { title: true, body: true, link: true, read: true },
      });
      expect(notes).toHaveLength(1);                       // it exists
      expect(notes[0].read).toBe(false);                   // and it is unread — it persists
      expect(notes[0].link).toBe(`/staff/cases/${f.caseId}`);
      expect(notes[0].body).toContain('Finance');          // says what it is waiting on
      // Addressed to the specialist, NOT to whoever happened to submit it.
      expect(await prisma.notification.count({ where: { userId: f.submitterId } })).toBe(0);
    } finally { await cleanup(f); }
  });

  it('the notification stays unread until the claim is approved, then clears', async () => {
    const f = await seed();
    try {
      const trigger: any = await svc.submit(f.choiceId, { id: f.submitterId, role: 'ADMIN', secondaryRoles: [] } as any);

      const stillUnread = await prisma.notification.count({
        where: { userId: f.consultantId, type: 'COMMISSION_TRIGGER_PENDING', read: false },
      });
      expect(stillUnread).toBe(1);   // persists while PENDING

      await svc.approve(trigger.id, { commissionType: 'FIXED', commissionValue: 1000 }, { id: f.submitterId, role: 'OWNER', secondaryRoles: [] } as any);

      const afterApproval = await prisma.notification.count({
        where: { userId: f.consultantId, type: 'COMMISSION_TRIGGER_PENDING', read: false },
      });
      expect(afterApproval).toBe(0);  // cleared by approval, not by the user
      // Kept rather than deleted, so the specialist can still see it happened.
      expect(await prisma.notification.count({ where: { userId: f.consultantId, type: 'COMMISSION_TRIGGER_PENDING' } })).toBe(1);
    } finally { await cleanup(f); }
  });

  it('falls back to the submitter when the case has no Admission Specialist', async () => {
    // Better that the submitter hears than that the claim waits silently.
    const f = await seed();
    try {
      await prisma.case.update({ where: { id: f.caseId }, data: { consultantId: null } });
      await svc.submit(f.choiceId, { id: f.submitterId, role: 'ADMIN', secondaryRoles: [] } as any);
      expect(await prisma.notification.count({ where: { userId: f.submitterId, type: 'COMMISSION_TRIGGER_PENDING' } })).toBe(1);
    } finally { await cleanup(f); }
  });

  it('a notification failure never costs the claim', async () => {
    // The claim is the money; the badge is not. Submitting must survive a
    // broken notification write.
    const f = await seed();
    try {
      const broken = new CommissionTriggersService(
        prisma as any,
        new CommissionsService(prisma as any, events),
        { create: async () => { throw new Error('notifications down'); } } as any,
      );
      const trigger: any = await broken.submit(f.choiceId, { id: f.submitterId, role: 'ADMIN', secondaryRoles: [] } as any);
      expect(trigger?.id).toBeTruthy();
      expect(await prisma.commissionTrigger.count({ where: { programmeChoiceId: f.choiceId } })).toBe(1);
    } finally { await cleanup(f); }
  });
});
