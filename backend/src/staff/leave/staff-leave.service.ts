import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStaffLeaveDto } from '../team/dto/team.dto';

// PR-BOOKING-ADMIN-B slice 2 — staff self-service leave requests.
//
// Any staff member requests their OWN leave → status REQUESTED. A pending
// request removes those days from new-booking availability immediately (the
// slot engine treats REQUESTED like APPROVED for blocking) — but it is NOT
// permanent until an ADMIN/OWNER approves it (that lives on the Team panel).
// A staff member may withdraw their own still-pending request → CANCELLED,
// which reopens the days. Existing confirmed bookings are never touched here.
@Injectable()
export class StaffLeaveService {
  constructor(private readonly prisma: PrismaService) {}

  /** Raise a leave request for the signed-in staff member (→ REQUESTED). */
  async requestOwn(userId: string, dto: CreateStaffLeaveDto) {
    // Lexical compare is valid for zero-padded YYYY-MM-DD.
    if (dto.endDate < dto.startDate) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
    return this.prisma.staffLeave.create({
      data: {
        staffId: userId,          // always the caller — never from the body
        startDate: dto.startDate,
        endDate: dto.endDate,
        kind: 'DAY_OFF',
        status: 'REQUESTED',      // pending an admin decision
        reason: dto.reason ?? null,
        requestedById: userId,
      },
      select: {
        id: true, startDate: true, endDate: true, kind: true, status: true,
        reason: true, decidedAt: true, createdAt: true,
      },
    });
  }

  /** The signed-in staff member's own leave (all statuses), future-first. */
  async listOwn(userId: string) {
    return this.prisma.staffLeave.findMany({
      where: { staffId: userId },
      orderBy: [{ startDate: 'desc' }],
      select: {
        id: true, startDate: true, endDate: true, kind: true, status: true,
        reason: true, decidedAt: true, createdAt: true,
      },
    });
  }

  /** Withdraw the caller's OWN still-pending request → CANCELLED. */
  async withdrawOwn(userId: string, leaveId: string) {
    const lv = await this.prisma.staffLeave.findFirst({
      where: { id: leaveId, staffId: userId },
      select: { id: true, status: true },
    });
    if (!lv) throw new NotFoundException('Leave request not found');
    if (lv.status !== 'REQUESTED') {
      throw new BadRequestException('Only a pending request can be withdrawn');
    }
    await this.prisma.staffLeave.update({
      where: { id: leaveId },
      data: { status: 'CANCELLED', decidedAt: new Date() },
    });
    return { ok: true };
  }
}
