import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// PR-DIARY — Client Officer daily diary (Option 1: a live agenda). A read-only
// composition of the two streams of dated, assigned work a staff member owns:
//   • nurture call tasks   (NurtureCallTask.dueDate, PENDING)
//   • consultation meetings (Consultation.scheduledAt, BOOKED/CONFIRMED)
//
// Two buckets, by the NZ calendar day (the business timezone):
//   • today  — due/scheduled today, still open
//   • missed — from a PRIOR day, still open (PENDING calls / un-actioned meetings)
// Future items are intentionally omitted (this is "today + overdue", not a calendar).
//
// Read-only + no duplicated action logic: the diary never marks anything. Rows are
// actioned on the existing surfaces — call tasks via the Follow-ups outcome flow
// (POST /staff/nurture/tasks/:id/outcome), meetings via My Meetings' staffMarkStatus
// (PATCH /staff/consultations/:id/status). It reuses the same "mine" filter pattern
// those surfaces use (assignedToId = caller; admin tier sees everyone).

export type StaffActor = { userId: string; role: string };
const ADMIN_TIER = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);
const NZ_TZ = 'Pacific/Auckland';

export interface DiaryCall {
  id: string; step: number; dueDate: Date;
  leadId: string; clientId: string | null; clientName: string | null; reason: string | null;
}
export interface DiaryMeeting {
  id: string; type: string; status: string; scheduledAt: Date | null; clientName: string | null;
}
export interface DiaryResponse {
  today:  { meetings: DiaryMeeting[]; calls: DiaryCall[] };
  missed: { meetings: DiaryMeeting[]; calls: DiaryCall[] };
  generatedAt: Date;
}

@Injectable()
export class DiaryService {
  constructor(private readonly prisma: PrismaService) {}

  // NZ calendar date ('YYYY-MM-DD') — lexicographically comparable.
  private nzDate(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: NZ_TZ }).format(d);
  }

  async getMyDiary(actor: StaffActor, now: Date = new Date()): Promise<DiaryResponse> {
    const isAdmin = ADMIN_TIER.has(actor.role);
    const mine = isAdmin ? {} : { assignedToId: actor.userId };

    const [callRows, meetingRows] = await Promise.all([
      this.prisma.nurtureCallTask.findMany({
        where: { status: 'PENDING', ...mine },
        orderBy: { dueDate: 'asc' },
        include: {
          lead: { select: { id: true, clientId: true, nurtureReason: true, contact: { select: { fullName: true } } } },
        },
      }),
      this.prisma.consultation.findMany({
        where: { status: { in: ['BOOKED', 'CONFIRMED'] }, ...mine },
        orderBy: { scheduledAt: 'asc' },
        include: {
          lead: { select: { contact: { select: { fullName: true, user: { select: { name: true } } } } } },
        },
      }),
    ]);

    const today = this.nzDate(now);
    const res: DiaryResponse = {
      today:  { meetings: [], calls: [] },
      missed: { meetings: [], calls: [] },
      generatedAt: now,
    };

    for (const c of callRows) {
      const day = this.nzDate(c.dueDate);
      const row: DiaryCall = {
        id: c.id, step: c.step, dueDate: c.dueDate,
        leadId: c.leadId, clientId: c.lead?.clientId ?? null,
        clientName: c.lead?.contact?.fullName ?? null, reason: c.lead?.nurtureReason ?? null,
      };
      if (day === today) res.today.calls.push(row);
      else if (day < today) res.missed.calls.push(row);
      // future (day > today) omitted
    }

    for (const m of meetingRows) {
      if (!m.scheduledAt) continue; // no date to place on the agenda
      const day = this.nzDate(m.scheduledAt);
      const row: DiaryMeeting = {
        id: m.id, type: String(m.type), status: String(m.status), scheduledAt: m.scheduledAt,
        clientName: m.lead?.contact?.fullName ?? m.lead?.contact?.user?.name ?? null,
      };
      if (day === today) res.today.meetings.push(row);
      else if (day < today) res.missed.meetings.push(row);
    }

    return res;
  }
}
