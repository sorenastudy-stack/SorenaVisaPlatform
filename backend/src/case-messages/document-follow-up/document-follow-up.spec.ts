import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { DocumentFollowUpService } from './document-follow-up.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CaseMessagesService } from '../case-messages.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  CLIENT_DOCUMENT_FOLLOW_UP,
  CLIENT_FOLLOW_UP_DAYS,
  followUpLink,
  isClientFollowUpDue,
  planClientDocumentFollowUps,
} from './document-follow-up.logic';

// PR-CHECKLIST item 3 — the 2-week client document chase.
//
// The interesting failures here are not "does it fire" but "does it fire more
// than once", "does it fire for something already delivered", and "does it stop
// when the document arrives" — a reminder that nags after you have acted is
// worse than no reminder, because people learn to ignore the whole channel.
//
// So the DB-level tests drive the REAL sweep and the REAL client fulfilment
// endpoint path, and assert on rows.

const prisma = new PrismaClient();
const notifications = new NotificationsService(prisma as any);
const sweep = new DocumentFollowUpService(prisma as any, notifications);
const messages = new CaseMessagesService(prisma as any, new CryptoService(new ConfigService()));

const DAY = 24 * 3600 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const tag = () => 'DOCFU-' + randomBytes(4).toString('hex');

async function seed(opts: { stage?: any } = {}) {
  const t = tag();
  const lia = await prisma.user.create({
    data: { name: `${t} lia`, email: `${t}-lia@test.local`, role: 'LIA', isActive: true },
    select: { id: true },
  });
  const student = await prisma.user.create({
    data: { name: `${t} student`, email: `${t}-stu@test.local`, role: 'STUDENT', isActive: true },
    select: { id: true },
  });
  const contact = await prisma.contact.create({
    data: { fullName: `${t} client`, email: `${t}@test.local`, userId: student.id },
    select: { id: true },
  });
  const lead = await prisma.lead.create({ data: { contactId: contact.id }, select: { id: true } });
  const kase = await prisma.case.create({
    data: { leadId: lead.id, consultantId: lia.id, stage: opts.stage ?? 'VISA' },
    select: { id: true },
  });
  const admission = await prisma.admissionApplication.create({
    data: { caseId: kase.id, contactId: contact.id }, select: { id: true },
  });
  const visaApp = await prisma.visaApplication.create({
    data: { applicationId: admission.id }, select: { id: true },
  });
  const doc = await prisma.visaSupportingDocument.create({
    data: { visaApplicationId: visaApp.id, documentType: 'PASSPORT' }, select: { id: true },
  });
  return { t, liaId: lia.id, studentId: student.id, contactId: contact.id, leadId: lead.id, caseId: kase.id, admissionId: admission.id, visaAppId: visaApp.id, docId: doc.id };
}

/** Create a real DOCUMENT_REQUEST through the real LIA endpoint path, then age it. */
async function requestDocument(f: any, docType: string, ageDays: number) {
  const msg = await messages.requestDocument(
    f.caseId,
    { body: `Please send your ${docType}.`, requestedDocType: docType } as any,
    { id: f.liaId, name: 'LIA', role: 'LIA' },
  );
  await prisma.caseMessage.update({ where: { id: msg.id }, data: { createdAt: daysAgo(ageDays) } });
  return msg.id;
}

const noticesFor = (caseId: string, messageId: string) =>
  prisma.notification.findMany({
    where: { type: CLIENT_DOCUMENT_FOLLOW_UP, link: followUpLink(caseId, messageId) },
    select: { userId: true, title: true, body: true, read: true },
  });

async function cleanup(f: any) {
  const d = (p: Promise<any>) => p.catch(() => {});
  await d(prisma.notification.deleteMany({ where: { userId: { in: [f.liaId, f.studentId] } } }));
  await d(prisma.caseMessage.deleteMany({ where: { caseId: f.caseId } }));
  await d(prisma.auditLog.deleteMany({ where: { userId: { in: [f.liaId, f.studentId] } } }));
  await d(prisma.visaSupportingDocument.deleteMany({ where: { visaApplicationId: f.visaAppId } }));
  await d(prisma.visaApplication.deleteMany({ where: { id: f.visaAppId } }));
  await d(prisma.admissionApplication.deleteMany({ where: { id: f.admissionId } }));
  await d(prisma.case.deleteMany({ where: { id: f.caseId } }));
  await d(prisma.lead.deleteMany({ where: { id: f.leadId } }));
  await d(prisma.contact.deleteMany({ where: { id: f.contactId } }));
  await d(prisma.user.deleteMany({ where: { id: { in: [f.liaId, f.studentId] } } }));
}

afterAll(async () => { await prisma.$disconnect(); });

// ── the clock rule, pinned ────────────────────────────────────────────────────

describe('two weeks means fourteen calendar days', () => {
  const asked = new Date('2026-08-01T09:00:00Z');

  it('is not due on day 13, is due on day 14', () => {
    expect(isClientFollowUpDue(asked, new Date('2026-08-14T09:00:00Z'))).toBe(false);
    expect(isClientFollowUpDue(asked, new Date('2026-08-15T09:00:00Z'))).toBe(true);
  });

  it('does not skip weekends the way the institution rule does', () => {
    // The 5-working-day institution follow-up deliberately steps over weekends
    // and NZ holidays. This one must not: a client's own fortnight includes them.
    expect(CLIENT_FOLLOW_UP_DAYS).toBe(14);
    const fortnight = new Date(asked.getTime() + 14 * DAY);
    expect(isClientFollowUpDue(asked, fortnight)).toBe(true);
  });

  it('nudges nobody when there is nobody to nudge', () => {
    // No requester and no consultant: a notification with no owner is noise,
    // and being un-dedupable it would be recreated on every sweep forever.
    const orphan = [{ messageId: 'm1', caseId: 'c1', requestedAt: asked, requestedDocType: 'Passport', requesterId: null, consultantId: null }];
    expect(planClientDocumentFollowUps(orphan, new Set(), new Date('2026-09-01T00:00:00Z'))).toEqual([]);
  });

  it('falls back to the case consultant when the requester is unknown', () => {
    const orphan = [{ messageId: 'm1', caseId: 'c1', requestedAt: asked, requestedDocType: 'Passport', requesterId: null, consultantId: 'consultant-1' }];
    const out = planClientDocumentFollowUps(orphan, new Set(), new Date('2026-09-01T00:00:00Z'));
    expect(out).toHaveLength(1);
    expect(out[0].userId).toBe('consultant-1');
  });
});

// ── against the database, through the real endpoints ──────────────────────────

describe('the sweep chases a real unanswered request', () => {
  it('raises one notification, to the person who asked, naming the document', async () => {
    const f = await seed();
    try {
      const messageId = await requestDocument(f, 'Bank statement', 15);

      const before = await noticesFor(f.caseId, messageId);
      expect(before).toHaveLength(0);

      const r = await sweep.runDailySweep();
      expect(r.created).toBeGreaterThanOrEqual(1);

      const after = await noticesFor(f.caseId, messageId);
      expect(after).toHaveLength(1);
      expect(after[0].userId).toBe(f.liaId);            // the requester, not the client
      expect(after[0].read).toBe(false);                // it persists
      expect(after[0].title).toContain('Bank statement'); // says what is missing
      expect(after[0].body).toContain('14 days');
      // Never the client — this is a CRM nudge, not a chase sent to the student.
      expect(await prisma.notification.count({ where: { userId: f.studentId } })).toBe(0);
    } finally { await cleanup(f); }
  });

  it('does not chase a request that is only a week old', async () => {
    const f = await seed();
    try {
      const messageId = await requestDocument(f, 'Passport', 7);
      await sweep.runDailySweep();
      expect(await noticesFor(f.caseId, messageId)).toHaveLength(0);
    } finally { await cleanup(f); }
  });

  it('running every day does not produce a notification every day', async () => {
    // The failure that would make staff mute the channel entirely.
    const f = await seed();
    try {
      const messageId = await requestDocument(f, 'Police certificate', 30);
      await sweep.runDailySweep();
      await sweep.runDailySweep();
      await sweep.runDailySweep();
      expect(await noticesFor(f.caseId, messageId)).toHaveLength(1);
    } finally { await cleanup(f); }
  });

  it('leaves closed cases alone', async () => {
    const f = await seed({ stage: 'WITHDRAWN' });
    try {
      const messageId = await requestDocument(f, 'Passport', 40);
      await sweep.runDailySweep();
      expect(await noticesFor(f.caseId, messageId)).toHaveLength(0);
    } finally { await cleanup(f); }
  });
});

describe('the chase stops when the document arrives', () => {
  it('the client fulfilling the request clears the notification', async () => {
    const f = await seed();
    try {
      const messageId = await requestDocument(f, 'Passport', 20);
      await sweep.runDailySweep();
      expect((await noticesFor(f.caseId, messageId))[0].read).toBe(false);

      // The real client-side endpoint path, not a direct row update.
      await messages.fulfilRequest(
        f.studentId, messageId, { fileId: f.docId } as any,
        { id: f.studentId, name: 'student', role: 'STUDENT' },
      );

      const after = await noticesFor(f.caseId, messageId);
      expect(after[0].read).toBe(true);   // cleared by the client's own action
      // and kept, not deleted — that we had to chase is worth knowing
      expect(after).toHaveLength(1);
    } finally { await cleanup(f); }
  });

  it('a cleared chase does not come back on the next sweep', async () => {
    const f = await seed();
    try {
      const messageId = await requestDocument(f, 'Passport', 20);
      await sweep.runDailySweep();
      await messages.fulfilRequest(
        f.studentId, messageId, { fileId: f.docId } as any,
        { id: f.studentId, name: 'student', role: 'STUDENT' },
      );
      await sweep.runDailySweep();

      const after = await noticesFor(f.caseId, messageId);
      expect(after).toHaveLength(1);
      expect(after[0].read).toBe(true);
    } finally { await cleanup(f); }
  });

  it('a request fulfilled before the fortnight is never chased at all', async () => {
    const f = await seed();
    try {
      const messageId = await requestDocument(f, 'Passport', 3);
      await messages.fulfilRequest(
        f.studentId, messageId, { fileId: f.docId } as any,
        { id: f.studentId, name: 'student', role: 'STUDENT' },
      );
      await prisma.caseMessage.update({ where: { id: messageId }, data: { createdAt: daysAgo(40) } });
      await sweep.runDailySweep();
      expect(await noticesFor(f.caseId, messageId)).toHaveLength(0);
    } finally { await cleanup(f); }
  });
});
