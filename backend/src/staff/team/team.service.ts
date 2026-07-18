import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StaffPhotoService } from '../photos/staff-photo.service';
import {
  UpdateStaffProfileDto, AvailabilityWindowDto, CreateStaffLeaveDto,
} from './dto/team.dto';
import { zonedWallTimeToUtc } from '../../booking/slot-engine';
import { normalizeLanguageCodes } from '../../common/language-codes';

// PR-BOOKING-ADMIN-A — adviser management service.
//
// Configures EXISTING staff users (role LIA or CONSULTANT) for booking:
// languages, canonical timezone, which session types they handle, an
// on/off toggle, and their weekly availability windows. It does not
// create users — that's /staff/users.

// Adviser-eligible roles.
// Phase 2a: CLIENT_CONSULTANT is included so the real client Consultant appears
// in the /staff/team roster and their `languages` become editable — the input
// that drives consultant auto-assignment's language matching. They don't have
// to offer bookable sessions (bookingActive defaults off); the profile editor
// (languages / timezone) is what matters here.
const BOOKABLE_STAFF_ROLES = ['LIA', 'CONSULTANT', 'CLIENT_CONSULTANT'] as const;

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: StaffPhotoService,
  ) {}

  /** List adviser-eligible users with booking config + availability summary. */
  async list() {
    const users = await this.prisma.user.findMany({
      where: { role: { in: [...BOOKABLE_STAFF_ROLES] } },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, email: true, role: true, isActive: true, photoKey: true,
        languages: true, timezone: true, bookableSessionTypes: true, bookingActive: true,
        liaProfile: { select: { iaaLicenceVerifiedAt: true } },
        _count: { select: { staffAvailability: { where: { active: true } } } },
      },
    });

    return Promise.all(users.map(async (u) => {
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
        photoUrl: await this.photos.presignedUrl(u.photoKey),
        languages: u.languages,
        timezone: u.timezone,
        bookableSessionTypes: u.bookableSessionTypes,
        bookingActive: u.bookingActive,
        windowCount,
        availabilitySet: windowCount > 0,
        bookable,
      };
    }));
  }

  /** One adviser's full config: profile + weekly windows + LIA status. */
  async getOne(id: string) {
    const u = await this.prisma.user.findFirst({
      where: { id, role: { in: [...BOOKABLE_STAFF_ROLES] } },
      select: {
        id: true, name: true, email: true, role: true, isActive: true, photoKey: true,
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
      photoUrl: await this.photos.presignedUrl(u.photoKey),
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
          // Phase 2a: normalise to lowercase, de-duped, valid ISO 639-1 codes
          // so staff languages line up exactly with client preferredLanguage.
          ...(dto.languages !== undefined ? { languages: normalizeLanguageCodes(dto.languages) } : {}),
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

    const conflicts = await this.findLeaveConflicts(id, staff.timezone, dto.startDate, dto.endDate);
    return { leave, conflicts };
  }

  /**
   * Existing BOOKED/CONFIRMED sessions that fall inside a leave range
   * [startYmd, endYmd] (inclusive), converted to UTC via the staff tz.
   * Surfaced to admins as a warning only — never modified or cancelled.
   */
  private async findLeaveConflicts(staffId: string, timezone: string, startYmd: string, endYmd: string) {
    const s = parseYmd(startYmd);
    const startUtc = zonedWallTimeToUtc(s.y, s.m, s.d, 0, timezone);
    const after = parseYmd(nextDayYmd(endYmd));
    const endExclusiveUtc = zonedWallTimeToUtc(after.y, after.m, after.d, 0, timezone);

    const rows = await this.prisma.consultation.findMany({
      where: {
        assignedToId: staffId,
        status: { in: ['BOOKED', 'CONFIRMED'] },
        scheduledAt: { gte: startUtc, lt: endExclusiveUtc },
      },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true, type: true, scheduledAt: true, bookingTimezone: true,
        lead: { select: { contact: { select: { fullName: true, user: { select: { name: true, email: true } } } } } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      type: c.type,
      scheduledAt: c.scheduledAt,
      timezone: c.bookingTimezone,
      clientName: c.lead?.contact?.fullName || c.lead?.contact?.user?.name || 'Client',
      clientEmail: c.lead?.contact?.user?.email ?? null,
    }));
  }

  /**
   * Approve or reject a PENDING (REQUESTED) leave request. ADMIN/OWNER tier
   * (guarded at the controller). Approve → APPROVED (leave becomes permanent,
   * identical downstream behaviour to an admin-created leave) + surfaces any
   * overlapping confirmed bookings as a warning. Reject → REJECTED (the days
   * reopen automatically, since only APPROVED/REQUESTED block bookings).
   * Existing confirmed bookings are never modified.
   */
  async decideLeave(staffId: string, leaveId: string, status: 'APPROVED' | 'REJECTED', actorUserId: string) {
    const staff = await this.requireStaff(staffId);
    const lv = await this.prisma.staffLeave.findFirst({
      where: { id: leaveId, staffId },
      select: { id: true, status: true, startDate: true, endDate: true },
    });
    if (!lv) throw new NotFoundException('Leave request not found');
    if (lv.status !== 'REQUESTED') {
      throw new BadRequestException('Only a pending request can be approved or rejected');
    }

    const leave = await this.prisma.staffLeave.update({
      where: { id: leaveId },
      data: { status, approvedById: actorUserId, decidedAt: new Date() },
      select: {
        id: true, startDate: true, endDate: true, kind: true, status: true,
        reason: true, decidedAt: true, createdAt: true,
      },
    });

    const conflicts = status === 'APPROVED'
      ? await this.findLeaveConflicts(staffId, staff.timezone, lv.startDate, lv.endDate)
      : [];
    return { leave, conflicts };
  }

  /**
   * Central triage queue: every PENDING (REQUESTED) request across all staff,
   * with the requester's name and a count of overlapping confirmed bookings
   * so an admin can prioritise. ADMIN/OWNER tier (guarded at the controller).
   */
  async listPendingLeave() {
    const rows = await this.prisma.staffLeave.findMany({
      where: { status: 'REQUESTED' },
      orderBy: [{ startDate: 'asc' }],
      select: {
        id: true, staffId: true, startDate: true, endDate: true, kind: true,
        reason: true, createdAt: true,
        staff: { select: { name: true, timezone: true } },
      },
    });
    const out = [];
    for (const r of rows) {
      const conflicts = await this.findLeaveConflicts(r.staffId, r.staff.timezone, r.startDate, r.endDate);
      out.push({
        id: r.id,
        staffId: r.staffId,
        staffName: r.staff.name,
        startDate: r.startDate,
        endDate: r.endDate,
        reason: r.reason,
        createdAt: r.createdAt,
        conflictCount: conflicts.length,
      });
    }
    return out;
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
