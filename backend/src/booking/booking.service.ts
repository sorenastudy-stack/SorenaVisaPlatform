import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BookingSessionType,
  getSessionConfig,
} from './session-config';
import {
  computeAvailableSlots,
  AvailableSlot,
  WeeklyWindow,
  BusyInterval,
} from './slot-engine';

// PR-BOOKING-1 — booking service (Stage 1+2: data loading + slot engine +
// commit guard). No controller/endpoints yet — that's the next stage.

export interface SlotQuery {
  adviserId: string;
  sessionType: BookingSessionType;
  dateFrom: Date;
  dateTo: Date;
  now?: Date; // injectable for tests; defaults to new Date()
}

export interface SlotResult {
  adviserId: string;
  timezone: string;
  sessionType: BookingSessionType;
  durationMinutes: number;
  slots: AvailableSlot[];
}

// Booking lifecycle states that occupy an adviser's time. PENDING is
// included only while a soft hold is live (holdExpiresAt > now).
const ACTIVE_BOOKING_STATUSES = ['BOOKED', 'CONFIRMED'] as const;

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verify an adviser is eligible for a session type. LIA sessions require
   * a User(role=LIA) with a verified LiaProfile. Throws otherwise.
   */
  async assertAdviserEligible(adviserId: string, sessionType: BookingSessionType): Promise<void> {
    const cfg = getSessionConfig(sessionType);
    if (!cfg.requiresLiaAdviser) return;

    const adviser = await this.prisma.user.findUnique({
      where: { id: adviserId },
      select: { role: true, isActive: true, liaProfile: { select: { iaaLicenceVerifiedAt: true } } },
    });
    if (!adviser || !adviser.isActive) {
      throw new BadRequestException('Adviser not found or inactive');
    }
    if (adviser.role !== 'LIA' || !adviser.liaProfile?.iaaLicenceVerifiedAt) {
      throw new ForbiddenException('LIA sessions require a verified LIA adviser');
    }
  }

  /** Verified-LIA advisers eligible for LIA sessions (caller can fan out). */
  async listEligibleLiaAdvisers(): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.user.findMany({
      where: {
        role: 'LIA',
        isActive: true,
        liaProfile: { iaaLicenceVerifiedAt: { not: null } },
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * The adviser pool for a session type. LIA → verified-LIA advisers.
   * FREE_15 / GAP_CLOSING → any active user with at least one active
   * availability window (the non-LIA pool).
   */
  async listAdvisersForType(sessionType: BookingSessionType): Promise<Array<{ id: string; name: string }>> {
    const cfg = getSessionConfig(sessionType);
    if (cfg.requiresLiaAdviser) return this.listEligibleLiaAdvisers();
    // Non-LIA pool: active advisers with availability who are NOT LIAs.
    // LIAs are reserved for paid LIA sessions.
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        role: { not: 'LIA' },
        adviserAvailability: { some: { active: true } },
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Capacity-aware slot listing for a session TYPE across its adviser pool.
   *
   * Capacity model: each adviser = 1 seat. For a given start time the
   * `remaining` count is the number of pool advisers who are BOTH (a)
   * available per their weekly hours at that time AND (b) not already
   * booked then. A time appears as long as remaining >= 1, and disappears
   * only when every adviser at that time is taken/unavailable. Each entry
   * carries the list of free adviserIds so the confirm step can assign
   * one (and fall back to another on a race).
   *
   * 24h lead time, grid = duration, and timezone correctness are all
   * inherited unchanged from the per-adviser getAvailableSlots.
   */
  async getSlotsForType(params: {
    sessionType: BookingSessionType;
    dateFrom: Date;
    dateTo: Date;
    now?: Date;
  }): Promise<{
    sessionType: BookingSessionType;
    durationMinutes: number;
    timezone: string;
    slots: Array<{ startUtc: string; endUtc: string; remaining: number; availableAdviserIds: string[] }>;
  }> {
    const { sessionType, dateFrom, dateTo } = params;
    const now = params.now ?? new Date();
    const cfg = getSessionConfig(sessionType);

    const advisers = await this.listAdvisersForType(sessionType);
    let timezone = 'Pacific/Auckland';
    // start instant → { endUtc, availableAdviserIds[] }. We ACCUMULATE
    // every free adviser at that time (no dedup) — that list size is the
    // capacity.
    const byStart = new Map<string, { startUtc: string; endUtc: string; availableAdviserIds: string[] }>();

    for (const adviser of advisers) {
      const res = await this.getAvailableSlots({ adviserId: adviser.id, sessionType, dateFrom, dateTo, now });
      if (res.slots.length > 0) timezone = res.timezone;
      for (const s of res.slots) {
        const key = s.start.toISOString();
        const entry = byStart.get(key);
        if (entry) {
          entry.availableAdviserIds.push(adviser.id);
        } else {
          byStart.set(key, { startUtc: key, endUtc: s.end.toISOString(), availableAdviserIds: [adviser.id] });
        }
      }
    }

    const slots = [...byStart.values()]
      .map((e) => ({
        startUtc: e.startUtc,
        endUtc: e.endUtc,
        remaining: e.availableAdviserIds.length,
        availableAdviserIds: e.availableAdviserIds,
      }))
      // A time with no free adviser simply never made it into the map, so
      // every entry here already has remaining >= 1.
      .sort((a, b) => a.startUtc.localeCompare(b.startUtc));

    return { sessionType, durationMinutes: cfg.durationMinutes, timezone, slots };
  }

  /**
   * The pool advisers free at one exact start time (capacity helper).
   * Reuses getSlotsForType over a tight window so 24h-lead / working-hours
   * / busy filtering all apply identically. Returns the free adviserIds in
   * pool order plus the resolved timezone.
   */
  private async availableAdvisersAt(
    sessionType: BookingSessionType, slotStart: Date, now: Date,
  ): Promise<{ adviserIds: string[]; timezone: string }> {
    const cfg = getSessionConfig(sessionType);
    const dateFrom = new Date(slotStart.getTime() - 60_000);
    const dateTo = new Date(slotStart.getTime() + cfg.durationMinutes * 60_000 + 60_000);
    const res = await this.getSlotsForType({ sessionType, dateFrom, dateTo, now });
    const entry = res.slots.find((s) => s.startUtc === slotStart.toISOString());
    return { adviserIds: entry?.availableAdviserIds ?? [], timezone: res.timezone };
  }

  /**
   * Resolve the CRM Lead for a signed-in client user (via the
   * lead.contact.userId chain), creating a minimal Contact + Lead if the
   * user doesn't have one yet (e.g. a Google-provisioned LEAD who hasn't
   * been through the scorecard). Contact carries no email here to avoid
   * the unique-email/emailHash constraints.
   */
  async resolveOrCreateLeadForUser(userId: string): Promise<string> {
    const existing = await this.prisma.lead.findFirst({
      where: { contact: { userId } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (existing) return existing.id;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });
    if (!user) throw new BadRequestException('User not found');

    return this.prisma.$transaction(async (tx) => {
      // One Contact per user (Contact.userId is unique). Re-check inside
      // the tx in case a Contact exists without a Lead.
      let contact = await tx.contact.findUnique({ where: { userId }, select: { id: true } });
      if (!contact) {
        contact = await tx.contact.create({
          data: { userId, fullName: user.name },
          select: { id: true },
        });
      }
      const lead = await tx.lead.create({ data: { contactId: contact.id }, select: { id: true } });
      return lead.id;
    });
  }

  /**
   * Create + confirm a FREE_15 booking for the signed-in client, capacity-
   * aware. The client supplies only the start time (the LEAD identity comes
   * from the JWT, never the body); the server assigns one of the advisers
   * free at that time.
   *
   * Capacity behaviour: we compute the advisers free at the time and try
   * to commit to each in turn (first free first; an optional
   * preferredAdviserId is tried first when still free). The per-adviser
   * commit guard + partial unique index prevent two clients getting the
   * SAME adviser at the same time — so on a race we just move to the next
   * free adviser. Only when EVERY adviser at that time is taken do we 409.
   * This means two clients CAN both book 9am when two advisers are free.
   */
  async createFreeBooking(params: {
    userId: string;
    slotStartUtc: string;
    preferredAdviserId?: string;
    now?: Date;
  }): Promise<{ id: string; scheduledAt: Date; scheduledEndAt: Date; status: string; timezone: string; adviserName: string }> {
    const sessionType: BookingSessionType = 'FREE_15';
    const now = params.now ?? new Date();

    const slotStart = new Date(params.slotStartUtc);
    if (isNaN(slotStart.getTime())) throw new BadRequestException('Invalid slotStartUtc');

    // Advisers free at this exact time (inside hours, ≥24h lead, not busy).
    const { adviserIds, timezone } = await this.availableAdvisersAt(sessionType, slotStart, now);
    if (adviserIds.length === 0) {
      throw new ConflictException('That time was just taken — please pick another slot');
    }

    // Try the preferred adviser first (if still free), then the rest in
    // pool order. "First free" assignment — noted as the simple policy;
    // least-loaded could replace this later.
    const ordered = params.preferredAdviserId && adviserIds.includes(params.preferredAdviserId)
      ? [params.preferredAdviserId, ...adviserIds.filter((id) => id !== params.preferredAdviserId)]
      : adviserIds;

    const leadId = await this.resolveOrCreateLeadForUser(params.userId);

    // One PENDING booking row, reused across adviser retries (commitBooking
    // overwrites assignedToId each attempt). Avoids orphan rows on a race.
    const consultation = await this.prisma.consultation.create({
      data: {
        leadId,
        type: 'FREE_15',
        amountNZD: 0,
        paymentStatus: 'PAID', // free → nothing to collect
        status: 'PENDING',
      },
      select: { id: true },
    });

    for (const adviserId of ordered) {
      try {
        const committed = await this.commitBooking({
          consultationId: consultation.id,
          adviserId,
          sessionType,
          slotStart,
          timezone,
          confirm: true,
        });
        const adviser = await this.prisma.user.findUnique({ where: { id: adviserId }, select: { name: true } });
        return {
          id: committed.id,
          scheduledAt: committed.scheduledAt,
          scheduledEndAt: committed.scheduledEndAt,
          status: committed.status,
          timezone,
          adviserName: adviser?.name ?? 'Your adviser',
        };
      } catch (e) {
        // This adviser was taken in the race — try the next free one.
        if (e instanceof ConflictException) continue;
        // Anything else: clean up the orphan PENDING row and rethrow.
        await this.prisma.consultation.delete({ where: { id: consultation.id } }).catch(() => {});
        throw e;
      }
    }

    // Every free adviser got taken between listing and committing.
    await this.prisma.consultation.delete({ where: { id: consultation.id } }).catch(() => {});
    throw new ConflictException('That time was just taken — please pick another slot');
  }

  /** The signed-in client's upcoming confirmed/booked sessions. */
  async getMyUpcomingBookings(userId: string, now: Date = new Date()): Promise<Array<{
    id: string; type: string; scheduledAt: Date; scheduledEndAt: Date | null;
    durationMinutes: number | null; timezone: string | null; adviserName: string | null; status: string;
  }>> {
    const rows = await this.prisma.consultation.findMany({
      where: {
        lead: { contact: { userId } },
        status: { in: [...ACTIVE_BOOKING_STATUSES] },
        scheduledAt: { gte: now },
      },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true, type: true, scheduledAt: true, scheduledEndAt: true,
        durationMinutes: true, bookingTimezone: true, status: true,
        assignedTo: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      scheduledAt: r.scheduledAt as Date,
      scheduledEndAt: r.scheduledEndAt,
      durationMinutes: r.durationMinutes,
      timezone: r.bookingTimezone,
      adviserName: r.assignedTo?.name ?? null,
      status: r.status,
    }));
  }

  /**
   * Available slots for an adviser + session type over a date range.
   * Loads active weekly windows and current busy intervals, then defers
   * to the pure engine.
   */
  async getAvailableSlots(query: SlotQuery): Promise<SlotResult> {
    const { adviserId, sessionType, dateFrom, dateTo } = query;
    const now = query.now ?? new Date();
    const cfg = getSessionConfig(sessionType);

    await this.assertAdviserEligible(adviserId, sessionType);

    // 1. Active weekly windows for the adviser.
    const availabilityRows = await this.prisma.adviserAvailability.findMany({
      where: { adviserId, active: true },
      select: { dayOfWeek: true, startMinute: true, endMinute: true, timezone: true },
    });
    if (availabilityRows.length === 0) {
      return { adviserId, timezone: 'Pacific/Auckland', sessionType, durationMinutes: cfg.durationMinutes, slots: [] };
    }
    // All rows share a timezone in practice; take the first as the adviser tz.
    const timezone = availabilityRows[0].timezone;
    const windows: WeeklyWindow[] = availabilityRows.map((r) => ({
      dayOfWeek: r.dayOfWeek,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
    }));

    // 2. Busy intervals: BOOKED/CONFIRMED, plus PENDING with a live hold.
    //    Widen the range by a day on each side to catch sessions that
    //    straddle the boundary.
    const rangeStart = new Date(dateFrom.getTime() - 86_400_000);
    const rangeEnd = new Date(dateTo.getTime() + 86_400_000);
    const bookings = await this.prisma.consultation.findMany({
      where: {
        assignedToId: adviserId,
        scheduledAt: { not: null, gte: rangeStart, lte: rangeEnd },
        OR: [
          { status: { in: [...ACTIVE_BOOKING_STATUSES] } },
          { status: 'PENDING', holdExpiresAt: { gt: now } },
        ],
      },
      select: { scheduledAt: true, scheduledEndAt: true, durationMinutes: true },
    });

    const busy: BusyInterval[] = bookings
      .filter((b) => b.scheduledAt)
      .map((b) => {
        const start = b.scheduledAt as Date;
        const end = b.scheduledEndAt
          ?? new Date(start.getTime() + (b.durationMinutes ?? cfg.durationMinutes) * 60_000);
        return { start, end };
      });

    const slots = computeAvailableSlots({
      timezone,
      windows,
      busy,
      durationMinutes: cfg.durationMinutes,
      dateFrom,
      dateTo,
      now,
      minLeadMinutes: 24 * 60, // 24h lead time
      bufferMinutes: 0,        // 0 for launch
    });

    return { adviserId, timezone, sessionType, durationMinutes: cfg.durationMinutes, slots };
  }

  /**
   * Commit a booking to a specific slot. Transactional re-check against
   * overlapping active bookings; the partial unique index
   * (consultations_adviser_slot_active_unique) is the hard backstop. On a
   * race we surface a clear 409 so the client picks another slot.
   *
   * Expects an existing Consultation row (created earlier — for paid types
   * after payment succeeds, for free types up front) identified by
   * consultationId. Sets the slot + duration + status.
   */
  async commitBooking(params: {
    consultationId: string;
    adviserId: string;
    sessionType: BookingSessionType;
    slotStart: Date;
    timezone: string;
    confirm?: boolean; // CONFIRMED if true (e.g. paid), else BOOKED
  }): Promise<{ id: string; scheduledAt: Date; scheduledEndAt: Date; status: string }> {
    const { consultationId, adviserId, sessionType, slotStart, timezone } = params;
    const cfg = getSessionConfig(sessionType);
    const slotEnd = new Date(slotStart.getTime() + cfg.durationMinutes * 60_000);
    const nextStatus = params.confirm ? 'CONFIRMED' : 'BOOKED';

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Re-check: any active booking for this adviser overlapping the slot?
        const clash = await tx.consultation.findFirst({
          where: {
            assignedToId: adviserId,
            id: { not: consultationId },
            status: { in: [...ACTIVE_BOOKING_STATUSES] },
            scheduledAt: { not: null, lt: slotEnd },
            scheduledEndAt: { gt: slotStart },
          },
          select: { id: true },
        });
        if (clash) {
          throw new ConflictException('That time was just taken — please pick another slot');
        }

        const updated = await tx.consultation.update({
          where: { id: consultationId },
          data: {
            assignedToId: adviserId,
            scheduledAt: slotStart,
            scheduledEndAt: slotEnd,
            durationMinutes: cfg.durationMinutes,
            bookingTimezone: timezone,
            status: nextStatus as any,
            holdExpiresAt: null,
          },
          select: { id: true, scheduledAt: true, scheduledEndAt: true, status: true },
        });

        return {
          id: updated.id,
          scheduledAt: updated.scheduledAt as Date,
          scheduledEndAt: updated.scheduledEndAt as Date,
          status: updated.status,
        };
      });
    } catch (e) {
      // The partial unique index throws P2002 if a concurrent commit beat
      // us between the re-check and the write — same user-facing 409.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('That time was just taken — please pick another slot');
      }
      throw e;
    }
  }
}
