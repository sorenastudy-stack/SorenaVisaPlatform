import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UpdateStaffProfileDto, AvailabilityWindowDto, CreateStaffLeaveDto,
} from './dto/team.dto';
import { zonedWallTimeToUtc } from '../../booking/slot-engine';

// PR-BOOKING-ADMIN-A — adviser management service.
//
// Configures EXISTING staff users (role LIA or CONSULTANT) for booking:
// languages, canonical timezone, which session types they handle, an
// on/off toggle, and their weekly availability windows. It does not
// create users — that's /staff/users.

// Adviser-eligible roles.
const BOOKABLE_STAFF_ROLES = ['LIA', 'CONSULTANT'] as const;

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  /** List adviser-eligible users with booking config + availability summary. */
  async list() {
    const users = await this.prisma.user.findMany({
      where: { role: { in: [...BOOKABLE_STAFF_ROLES] } },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        languages: true, timezone: true, bookableSessionTypes: true, bookingActive: true,
        liaProfile: { select: { iaaLicenceVerifiedAt: true } },
        _count: { select: { staffAvailability: { where: { active: true } } } },
      },
    });

    return users.map((u) => {
      const windowCount = u._count.staffAvailability;
      const liaVerified = !!u.liaProfile?.iaaLicenceVerifiedAt;
      const hasTypes = u.bookableSessionTypes.length > 0;
      // Derived: bookable if active toggle on, has at least one type, and
      // has availability. (Per-type LIA verification is enforced at the
      // engine + on save; the list "bookable" is the coarse signal.)
      const bookable = u.bookingActive && hasTypes && windowCount > 0;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        liaVerified,
        languages: u.languages,
        timezone: u.timezone,
        bookableSessionTypes: u.bookableSessionTypes,
        bookingActive: u.bookingActive,
        windowCount,
        availabilitySet: windowCount > 0,
        bookable,
      };
    });
  }

  /** One adviser's full config: profile + weekly windows + LIA status. */
  async getOne(id: string) {
    const u = await this.prisma.user.findFirst({
      where: { id, role: { in: [...BOOKABLE_STAFF_ROLES] } },
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        languages: true, timezone: true, bookableSessionTypes: true, bookingActive: true,
        liaProfile: { select: { iaaLicenceVerifiedAt: true } },
        staffAvailability: {
          where: { active: true },
          orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
          select: { id: true, dayOfWeek: true, startMinute: true, endMinute: true, timezone: true },
        },
      },
    });
    if (!u) throw new NotFoundException('Staff member not found');

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      liaVerified: !!u.liaProfile?.iaaLicenceVerifiedAt,
      languages: u.languages,
      timezone: u.timezone,
      bookableSessionTypes: u.bookableSessionTypes,
      bookingActive: u.bookingActive,
      windows: u.staffAvailability,
    };
  }

  /**
   * Update booking profile (languages / timezone / types / active).
   * LIA may only be a bookable type for a verified-LIA user. Setting the
   * timezone propagates into the adviser's availability rows so the slot
   * engine (which reads the row timezone) stays consistent.
   */
  async updateProfile(id: string, dto: UpdateStaffProfileDto) {
    const u = await this.prisma.user.findFirst({
      where: { id, role: { in: [...BOOKABLE_STAFF_ROLES] } },
      select: { id: true, role: true, liaProfile: { select: { iaaLicenceVerifiedAt: true } } },
    });
    if (!u) throw new NotFoundException('Staff member not found');

    if (dto.bookableSessionTypes?.includes('LIA')) {
      const verified = u.role === 'LIA' && !!u.liaProfile?.iaaLicenceVerifiedAt;
      if (!verified) {
        throw new BadRequestException('Only a verified LIA adviser can offer LIA sessions');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(dto.languages !== undefined ? { languages: dto.languages } : {}),
          ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
          ...(dto.bookableSessionTypes !== undefined ? { bookableSessionTypes: dto.bookableSessionTypes } : {}),
          ...(dto.bookingActive !== undefined ? { bookingActive: dto.bookingActive } : {}),
        },
      });
      // Mirror the canonical timezone into the adviser's availability rows.
      if (dto.timezone !== undefined) {
        await tx.staffAvailability.updateMany({
          where: { staffId: id },
          data: { timezone: dto.timezone },
        });
      }
    });

    return this.getOne(id);
  }

  /**
   * Replace the adviser's full weekly window set. Validates each window
   * (start < end) and that windows don't overlap within a day, then
   * deletes the existing active rows and recreates them — stamped with
   * the adviser's canonical timezone.
   */
  async replaceAvailability(id: string, windows: AvailabilityWindowDto[]) {
    const u = await this.prisma.user.findFirst({
      where: { id, role: { in: [...BOOKABLE_STAFF_ROLES] } },
      select: { id: true, timezone: true },
    });
    if (!u) throw new NotFoundException('Staff member not found');

    // Per-window: start < end.
    for (const w of windows) {
      if (w.startMinute >= w.endMinute) {
        throw new BadRequestException(
          `Invalid window on day ${w.dayOfWeek}: start must be before end`,
        );
      }
    }
    // No overlaps within the same weekday (end-exclusive).
    const byDay = new Map<number, AvailabilityWindowDto[]>();
    for (const w of windows) {
      const list = byDay.get(w.dayOfWeek) ?? [];
      list.push(w);
      byDay.set(w.dayOfWeek, list);
    }
    for (const [day, list] of byDay) {
      const sorted = [...list].sort((a, b) => a.startMinute - b.startMinute);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].startMinute < sorted[i - 1].endMinute) {
          throw new BadRequestException(`Overlapping windows on day ${day}`);
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.staffAvailability.deleteMany({ where: { staffId: id } });
      if (windows.length > 0) {
        await tx.staffAvailability.createMany({
          data: windows.map((w) => ({
            staffId: id,
            dayOfWeek: w.dayOfWeek,
            startMinute: w.startMinute,
            endMinute: w.endMinute,
            timezone: u.timezone,
            active: true,
          })),
        });
      }
    });

    return this.getOne(id);
  }

  // ── Leave / time-off (PR-BOOKING-ADMIN-B, Stage B slice 1) ─────────────

  /** Load an adviser-eligible user (or 404). */
  private async requireStaff(id: string): Promise<{ id: string; timezone: string }> {
    const u = await this.prisma.user.findFirst({
      where: { id, role: { in: [...BOOKABLE_STAFF_ROLES] } },
      select: { id: true, timezone: true },
    });
    if (!u) throw new NotFoundException('Staff member not found');
    return u;
  }

  /**
   * Admin sets leave directly for an adviser → created APPROVED (this is the
   * direct-set path; the requested→approved lifecycle is modelled but its UI
   * is slice 2). Validates YYYY-MM-DD + endDate >= startDate.
   *
   * Saves the leave regardless, then runs CONFLICT DETECTION: existing
   * BOOKED/CONFIRMED sessions whose scheduledAt falls inside the leave (the
   * inclusive day range converted to UTC bounds via the adviser's tz). Those
   * bookings are RETURNED but never modified or cancelled — staff rebook or
   * notify manually.
   */
  async createLeave(id: string, dto: CreateStaffLeaveDto, actorUserId: string) {
    const staff = await this.requireStaff(id);

    // Lexical compare is valid for zero-padded YYYY-MM-DD.
    if (dto.endDate < dto.startDate) {
      throw new BadRequestException('endDate must be on or after startDate');
    }

    const now = new Date();
    const leave = await this.prisma.staffLeave.create({
      data: {
        staffId: id,
        startDate: dto.startDate,
        endDate: dto.endDate,
        kind: 'DAY_OFF',
        status: 'APPROVED',          // admin direct-set
        reason: dto.reason ?? null,
        requestedById: actorUserId,
        approvedById: actorUserId,
        decidedAt: now,
      },
      select: {
        id: true, startDate: true, endDate: true, kind: true, status: true,
        reason: true, decidedAt: true, createdAt: true,
      },
    });

    // Conflict window: [startDate 00:00, dayAfter(endDate) 00:00) in adviser tz.
    const s = parseYmd(dto.startDate);
    const startUtc = zonedWallTimeToUtc(s.y, s.m, s.d, 0, staff.timezone);
    const after = parseYmd(nextDayYmd(dto.endDate));
    const endExclusiveUtc = zonedWallTimeToUtc(after.y, after.m, after.d, 0, staff.timezone);

    const conflictRows = await this.prisma.consultation.findMany({
      where: {
        assignedToId: id,
        status: { in: ['BOOKED', 'CONFIRMED'] },
        scheduledAt: { gte: startUtc, lt: endExclusiveUtc },
      },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true, type: true, scheduledAt: true, bookingTimezone: true,
        lead: { select: { contact: { select: { fullName: true, user: { select: { name: true, email: true } } } } } },
      },
    });

    const conflicts = conflictRows.map((c) => ({
      id: c.id,
      type: c.type,
      scheduledAt: c.scheduledAt,
      timezone: c.bookingTimezone,
      clientName: c.lead?.contact?.fullName || c.lead?.contact?.user?.name || 'Client',
      clientEmail: c.lead?.contact?.user?.email ?? null,
    }));

    return { leave, conflicts };
  }

  /** List an adviser's leave, future-first. Optional status filter. */
  async listLeave(id: string, status?: string) {
    await this.requireStaff(id);
    const allowed = ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED'];
    const where: { staffId: string; status?: any } = { staffId: id };
    if (status && allowed.includes(status)) where.status = status;
    return this.prisma.staffLeave.findMany({
      where,
      // YYYY-MM-DD sorts chronologically; desc puts upcoming/newest first.
      orderBy: [{ startDate: 'desc' }],
      select: {
        id: true, startDate: true, endDate: true, kind: true, status: true,
        reason: true, decidedAt: true, createdAt: true,
      },
    });
  }

  /** Remove/cancel a leave (admin). Scoped to the adviser to avoid id mix-ups. */
  async deleteLeave(id: string, leaveId: string) {
    await this.requireStaff(id);
    const lv = await this.prisma.staffLeave.findFirst({
      where: { id: leaveId, staffId: id },
      select: { id: true },
    });
    if (!lv) throw new NotFoundException('Leave not found');
    await this.prisma.staffLeave.delete({ where: { id: leaveId } });
    return { ok: true };
  }
}

// ── YYYY-MM-DD calendar helpers (pure; UTC-anchored, DST-free) ──────────────
function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d };
}
function nextDayYmd(ymd: string): string {
  const t = new Date(`${ymd}T00:00:00Z`).getTime() + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
