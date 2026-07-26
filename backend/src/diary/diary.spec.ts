/**
 * PR-DIARY — DiaryService. DB-backed (real Prisma, throwaway DB). Confirms the
 * four-item scenario lands in the right buckets: a call due today, an overdue
 * call, a meeting today, and a past-due un-actioned meeting — plus that actioned/
 * future items and other officers' items are excluded, and admins see everyone.
 */

import { PrismaClient } from '@prisma/client';
import { DiaryService } from './diary.service';

jest.setTimeout(60000);

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

describe('DiaryService', () => {
  let prisma: PrismaClient;
  let svc: DiaryService;
  const NOW = new Date('2026-06-15T02:00:00.000Z'); // ~NZ 14:00 on 2026-06-15

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    svc = new DiaryService(prisma as any);
  }, 60000);

  afterAll(async () => { await prisma.$disconnect(); });

  let seq = 0;
  const stamp = () => `dy${Date.now()}_${(seq += 1)}`;

  async function mkOfficer(): Promise<string> {
    const s = stamp();
    const u = await prisma.user.create({ data: { name: `CO ${s}`, email: `co.${s}@t.local`, passwordHash: 'x', role: 'CLIENT_CONSULTANT' as any, isActive: true } });
    return u.id;
  }
  async function mkLead(name: string): Promise<string> {
    const s = stamp();
    const contact = await prisma.contact.create({ data: { fullName: name, email: `l.${s}@t.local` } });
    const lead = await prisma.lead.create({ data: { contactId: contact.id, leadStatus: 'NURTURE' } as any });
    return lead.id;
  }
  async function mkCall(coId: string, leadId: string, step: number, dueDate: Date, status = 'PENDING') {
    return prisma.nurtureCallTask.create({ data: { leadId, assignedToId: coId, step, dueDate, status: status as any } });
  }
  async function mkMeeting(coId: string, leadId: string, scheduledAt: Date, status: string) {
    return prisma.consultation.create({ data: { leadId, assignedToId: coId, type: 'FREE_15', status: status as any, amountNZD: 0, scheduledAt } as any });
  }

  it('sorts the four items into Today vs Missed, and excludes the rest', async () => {
    const co = await mkOfficer();

    const callToday   = await mkCall(co, await mkLead('Call Today'),   2, NOW);              // due today
    const callOverdue = await mkCall(co, await mkLead('Call Overdue'), 4, addDays(NOW, -2));  // past day
    const meetToday   = await mkMeeting(co, await mkLead('Meet Today'),  NOW, 'BOOKED');      // today
    const meetPast    = await mkMeeting(co, await mkLead('Meet Past'),   addDays(NOW, -3), 'CONFIRMED'); // past, unactioned

    // Noise that must NOT appear anywhere:
    const meetDone = await mkMeeting(co, await mkLead('Meet Done'), addDays(NOW, -1), 'COMPLETED'); // actioned
    const callFuture = await mkCall(co, await mkLead('Call Future'), 7, addDays(NOW, 3));           // future
    const otherCo = await mkOfficer();
    const callOther = await mkCall(otherCo, await mkLead('Other CO Call'), 2, NOW);                 // not mine

    const d = await svc.getMyDiary({ userId: co, role: 'CLIENT_CONSULTANT' }, NOW);

    const todayCallIds  = d.today.calls.map((c) => c.id);
    const missedCallIds = d.missed.calls.map((c) => c.id);
    const todayMeetIds  = d.today.meetings.map((m) => m.id);
    const missedMeetIds = d.missed.meetings.map((m) => m.id);

    // The four land where they should:
    expect(todayCallIds).toContain(callToday.id);
    expect(missedCallIds).toContain(callOverdue.id);
    expect(todayMeetIds).toContain(meetToday.id);
    expect(missedMeetIds).toContain(meetPast.id);

    // Cross-checks — none in the wrong bucket:
    expect(missedCallIds).not.toContain(callToday.id);
    expect(todayCallIds).not.toContain(callOverdue.id);
    expect(missedMeetIds).not.toContain(meetToday.id);
    expect(todayMeetIds).not.toContain(meetPast.id);

    // Excluded entirely: an actioned (COMPLETED) meeting, a future call, another CO's call.
    const allIds = [...todayCallIds, ...missedCallIds, ...todayMeetIds, ...missedMeetIds];
    expect(allIds).not.toContain(meetDone.id);
    expect(allIds).not.toContain(callFuture.id);
    expect(allIds).not.toContain(callOther.id);

    // Client names resolve.
    expect(d.today.calls.find((c) => c.id === callToday.id)!.clientName).toBe('Call Today');
    expect(d.missed.meetings.find((m) => m.id === meetPast.id)!.clientName).toBe('Meet Past');
  });

  it('admin tier sees every officer’s items; a non-owning officer sees none of them', async () => {
    const coA = await mkOfficer();
    const coB = await mkOfficer();
    const call = await mkCall(coA, await mkLead('A Client'), 2, NOW);

    const adminView = await svc.getMyDiary({ userId: 'x', role: 'OWNER' }, NOW);
    expect(adminView.today.calls.map((c) => c.id)).toContain(call.id);

    const otherView = await svc.getMyDiary({ userId: coB, role: 'CLIENT_CONSULTANT' }, NOW);
    expect(otherView.today.calls.map((c) => c.id)).not.toContain(call.id);
  });
});
