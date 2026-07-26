/**
 * PR-NURTURE — NurtureService. DB-backed (real Prisma, throwaway DB); the mail
 * layer is stubbed (returns "sent"). The clock is injected two ways: enrolment
 * sets a real nurtureStartedAt which we then pin to a fixed START, and every
 * sweep takes an explicit `now`.
 *
 * Covers: the 21-day schedule + no double-sends across re-runs; all 4
 * auto-detectable exit conditions; manual stop; the Day-21 → monthly-newsletter
 * transition + cadence + empty-month suppression; permanent unsubscribe; and
 * call-task assignment/visibility for the right Client Officer.
 */

import { PrismaClient } from '@prisma/client';
import { NurtureService } from './nurture.service';

jest.setTimeout(60000);

const START = new Date('2026-01-01T00:00:00.000Z');
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

describe('NurtureService', () => {
  let prisma: PrismaClient;
  let svc: NurtureService;
  let mail: { sendNurtureSequenceEmail: jest.Mock; sendNurtureNewsletter: jest.Mock };

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    mail = {
      sendNurtureSequenceEmail: jest.fn().mockResolvedValue(true),
      sendNurtureNewsletter: jest.fn().mockResolvedValue(true),
    };
    svc = new NurtureService(prisma as any, mail as any);
  }, 60000);

  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(() => {
    mail.sendNurtureSequenceEmail.mockClear();
    mail.sendNurtureNewsletter.mockClear();
    // Reset the newsletter content seam to empty each test.
    (svc as any).getNewsletterContent = async () => ({ blog: null, video: null, webinars: null });
  });

  // Isolate sweeps: park every still-active lead so it can't be swept by the
  // next test.
  afterEach(async () => {
    await prisma.lead.updateMany({
      where: { nurtureStage: { in: ['SEQUENCE', 'NEWSLETTER'] } },
      data: { nurtureStage: 'ENDED' },
    });
  });

  let seq = 0;
  const stamp = () => `nz${Date.now()}_${(seq += 1)}`;

  async function mkOfficer(): Promise<string> {
    const s = stamp();
    const u = await prisma.user.create({ data: { name: `CO ${s}`, email: `co.${s}@t.local`, passwordHash: 'x', role: 'CLIENT_CONSULTANT' as any, isActive: true } });
    return u.id;
  }

  // A lead with a COMPLETED FREE_15 (createdAt BEFORE START so it isn't mistaken
  // for a post-enrolment consultation), enrolled, then pinned to START.
  async function enrolledLead(coId: string | null): Promise<{ leadId: string; token: string }> {
    const s = stamp();
    const contact = await prisma.contact.create({ data: { fullName: `Lead ${s}`, email: `l.${s}@t.local` } });
    const lead = await prisma.lead.create({ data: { contactId: contact.id, leadStatus: 'SCORING_DONE' } as any });
    await prisma.consultation.create({
      data: { leadId: lead.id, type: 'FREE_15', status: 'COMPLETED', assignedToId: coId, amountNZD: 0, createdAt: new Date('2025-12-01T00:00:00Z') } as any,
    });
    await svc.enroll(lead.id, 'wants to think about cost', { userId: 'staff', role: 'CLIENT_CONSULTANT' });
    const updated = await prisma.lead.update({ where: { id: lead.id }, data: { nurtureStartedAt: START }, select: { nurtureUnsubToken: true } });
    return { leadId: lead.id, token: updated.nurtureUnsubToken! };
  }

  const seqRows = (leadId: string) => prisma.leadNurtureSent.findMany({ where: { leadId }, orderBy: { step: 'asc' } });
  const callTasks = (leadId: string) => prisma.nurtureCallTask.findMany({ where: { leadId }, orderBy: { step: 'asc' } });

  it('runs the 21-day schedule and never double-sends across re-runs', async () => {
    const co = await mkOfficer();
    const { leadId } = await enrolledLead(co);

    // Day 2 — only step 1 (Day 1 email) is due.
    let r = await svc.runDailySweep(addDays(START, 2));
    expect((await seqRows(leadId)).map((x) => x.step)).toEqual(['1']);
    expect(await callTasks(leadId)).toHaveLength(0);

    // Day 4 — step 2 (Day 3 call) is now due; step 3 email (Day 6) is not.
    await svc.runDailySweep(addDays(START, 4));
    expect((await callTasks(leadId)).map((t) => t.step)).toEqual([2]);
    expect((await seqRows(leadId)).map((x) => x.step)).toEqual(['1']);

    // Day 22 — everything else is due; sequence completes → NEWSLETTER.
    r = await svc.runDailySweep(addDays(START, 22));
    const emailsAll = (await seqRows(leadId)).map((x) => x.step).filter((s) => !s.startsWith('NL'));
    expect(emailsAll.sort()).toEqual(['1', '3', '5', '6']);        // 4 emails
    expect((await callTasks(leadId)).map((t) => t.step)).toEqual([2, 4, 7]); // 3 calls
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead!.nurtureStage).toBe('NEWSLETTER');

    // Re-run the SAME day — no duplicate emails or tasks (ledger + unique index).
    const beforeCalls = mail.sendNurtureSequenceEmail.mock.calls.length;
    r = await svc.runDailySweep(addDays(START, 22));
    expect(r.emailsSent).toBe(0);
    expect(r.callTasksCreated).toBe(0);
    expect(mail.sendNurtureSequenceEmail.mock.calls.length).toBe(beforeCalls);
    expect(emailsAll.length).toBe(4); // still 4
  });

  it('each of the 4 exit conditions ends the sequence and closes open call tasks', async () => {
    // (a) a contract now exists → ENDED, open task AUTO_CLOSED.
    {
      const { leadId } = await enrolledLead(await mkOfficer());
      await svc.runDailySweep(addDays(START, 4));               // creates step-2 call task
      expect((await callTasks(leadId))[0].status).toBe('PENDING');
      await prisma.contract.create({ data: { leadId, status: 'SENT' } as any });
      await svc.runDailySweep(addDays(START, 5));
      expect((await prisma.lead.findUnique({ where: { id: leadId } }))!.nurtureStage).toBe('ENDED');
      expect((await callTasks(leadId))[0].status).toBe('AUTO_CLOSED');
    }
    // (b) a new consultation booked after enrolment → ENDED.
    {
      const { leadId } = await enrolledLead(await mkOfficer());
      await prisma.consultation.create({ data: { leadId, type: 'GAP_CLOSING', status: 'BOOKED', amountNZD: 0, createdAt: addDays(START, 3) } as any });
      await svc.runDailySweep(addDays(START, 4));
      expect((await prisma.lead.findUnique({ where: { id: leadId } }))!.nurtureStage).toBe('ENDED');
    }
    // (c) marked QUALIFIED → ENDED.
    {
      const { leadId } = await enrolledLead(await mkOfficer());
      await prisma.lead.update({ where: { id: leadId }, data: { leadStatus: 'QUALIFIED' } });
      await svc.runDailySweep(addDays(START, 4));
      expect((await prisma.lead.findUnique({ where: { id: leadId } }))!.nurtureStage).toBe('ENDED');
    }
    // (d) marked DISQUALIFIED → ENDED.
    {
      const { leadId } = await enrolledLead(await mkOfficer());
      await prisma.lead.update({ where: { id: leadId }, data: { leadStatus: 'DISQUALIFIED' } });
      await svc.runDailySweep(addDays(START, 4));
      expect((await prisma.lead.findUnique({ where: { id: leadId } }))!.nurtureStage).toBe('ENDED');
    }
  });

  it('manual stop ends the sequence and closes open call tasks', async () => {
    const { leadId } = await enrolledLead(await mkOfficer());
    await svc.runDailySweep(addDays(START, 4)); // open step-2 task
    await svc.stopNurture(leadId, { userId: 'staff', role: 'CLIENT_CONSULTANT' });
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))!.nurtureStage).toBe('ENDED');
    expect((await callTasks(leadId))[0].status).toBe('AUTO_CLOSED');
    // A parked (ENDED) lead is never swept again.
    const r = await svc.runDailySweep(addDays(START, 22));
    expect(r.processed).toBe(0);
  });

  it('after Day 21 with no exit, transitions to a monthly newsletter cadence', async () => {
    const { leadId } = await enrolledLead(await mkOfficer());
    await svc.runDailySweep(addDays(START, 22)); // → NEWSLETTER, but no content yet
    expect(mail.sendNurtureNewsletter).not.toHaveBeenCalled();

    // Now there's content this month → first newsletter goes out.
    (svc as any).getNewsletterContent = async () => ({ blog: { title: 'Visa tips', url: 'https://sorenavisa.com/blog/1' }, video: null, webinars: null });
    await svc.runDailySweep(addDays(START, 23));
    expect(mail.sendNurtureNewsletter).toHaveBeenCalledTimes(1);
    let nls = (await seqRows(leadId)).filter((x) => x.step.startsWith('NL'));
    expect(nls).toHaveLength(1);

    // A day later — inside the ~monthly window → no second send.
    await svc.runDailySweep(addDays(START, 24));
    expect(mail.sendNurtureNewsletter).toHaveBeenCalledTimes(1);

    // ~4 weeks on (new month) → the next monthly newsletter sends.
    await svc.runDailySweep(addDays(START, 55));
    expect(mail.sendNurtureNewsletter).toHaveBeenCalledTimes(2);
    nls = (await seqRows(leadId)).filter((x) => x.step.startsWith('NL'));
    expect(nls).toHaveLength(2);
    expect(new Set(nls.map((x) => x.step)).size).toBe(2); // distinct month keys
  });

  it('unsubscribe stops EMAILS only — call tasks keep running (and is idempotent)', async () => {
    const { leadId, token } = await enrolledLead(await mkOfficer());
    await svc.runDailySweep(addDays(START, 4)); // Day-1 email sent + Day-3 call task created
    const emailsBefore = (await seqRows(leadId)).filter((x) => !x.step.startsWith('NL')).length;
    expect(emailsBefore).toBe(1);

    await svc.unsubscribe(token);
    await svc.unsubscribe(token);                // idempotent — no throw

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead!.nurtureUnsubscribedAt).not.toBeNull();
    // NOT ended, and the pending call task is untouched — the CO can still call.
    expect(lead!.nurtureStage).toBe('SEQUENCE');
    expect((await callTasks(leadId))[0].status).toBe('PENDING');

    // A full sweep at Day 22: NO more emails ever, but the remaining scheduled
    // call tasks (Day 9, Day 21) ARE still created.
    await svc.runDailySweep(addDays(START, 22));
    const emailsAfter = (await seqRows(leadId)).filter((x) => !x.step.startsWith('NL')).length;
    expect(emailsAfter).toBe(emailsBefore);                 // no new emails
    expect((await callTasks(leadId)).map((t) => t.step)).toEqual([2, 4, 7]); // all 3 calls exist
    expect((await callTasks(leadId)).every((t) => t.status === 'PENDING')).toBe(true);

    // And no newsletter is ever sent to an unsubscribed lead either.
    (svc as any).getNewsletterContent = async () => ({ blog: { title: 'x', url: 'https://x' }, video: null, webinars: null });
    await svc.runDailySweep(addDays(START, 23));
    expect((await seqRows(leadId)).some((x) => x.step.startsWith('NL'))).toBe(false);
  });

  it('call tasks are created for and visible to the right Client Officer only', async () => {
    const coA = await mkOfficer();
    const coB = await mkOfficer();
    const { leadId } = await enrolledLead(coA);
    await svc.runDailySweep(addDays(START, 4)); // step-2 call task → assigned to coA

    const task = (await callTasks(leadId))[0];
    expect(task.assignedToId).toBe(coA);

    const mineA = await svc.listMyCallTasks({ userId: coA, role: 'CLIENT_CONSULTANT' });
    expect(mineA.some((t) => t.leadId === leadId)).toBe(true);
    const mineB = await svc.listMyCallTasks({ userId: coB, role: 'CLIENT_CONSULTANT' });
    expect(mineB.some((t) => t.leadId === leadId)).toBe(false);
    const adminView = await svc.listMyCallTasks({ userId: 'x', role: 'OWNER' });
    expect(adminView.some((t) => t.leadId === leadId)).toBe(true);

    // coB cannot log an outcome on coA's task; coA can.
    await expect(svc.completeCallTask(task.id, { userId: coB, role: 'CLIENT_CONSULTANT' }, 'DONE', 'x'))
      .rejects.toBeDefined();
    await svc.completeCallTask(task.id, { userId: coA, role: 'CLIENT_CONSULTANT' }, 'DONE', 'left a voicemail');
    const done = (await callTasks(leadId))[0];
    expect(done.status).toBe('DONE');
    expect(done.completedById).toBe(coA);
  });
});
