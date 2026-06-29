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
   * Available slots for a session TYPE across its whole adviser pool.
   * Merges every pool adviser's slots, dedupes by start instant (first
   * adviser wins that time), and tags each slot with the adviser who will
   * take it — so the confirm step knows which adviser to book.
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
    slots: Array<{ startUtc: string; endUtc: string; adviserId: string }>;
  }> {
    const { sessionType, dateFrom, dateTo } = params;
    const now = params.now ?? new Date();
    const cfg = getSessionConfig(sessionType);

    const advisers = await this.listAdvisersForType(sessionType);
    let timezone = 'Pacific/Auckland';
    const byStart = new Map<string, { startUtc: string; endUtc: string; adviserId: string }>();

    for (const adviser of advisers) {
      const res = await this.getAvailableSlots({ adviserId: adviser.id, sessionType, dateFrom, dateTo, now });
      if (res.slots.length > 0) timezone = res.timezone;
      for (const s of res.slots) {
        const key = s.start.toISOString();
        if (!byStart.has(key)) {
          byStart.set(key, { startUtc: key, endUtc: s.end.toISOString(), adviserId: adviser.id });
        }
      }
    }

    const slots = [...byStart.values()].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
    return { sessionType, durationMinutes: cfg.durationMinutes, timezone, slots };
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
   * Create + confirm a FREE_15 booking for the signed-in client. Validates
   * the requested slot is genuinely offered for that adviser (inside
   * working hours, ≥24h lead, not taken), then creates the Consultation
   * and commits it transactionally. The slot/adviser come from the
   * client; the LEAD identity comes from the JWT, never the body.
   */
  async createFreeBooking(params: {
    userId: string;
    adviserId: string;
    slotStartUtc: string;
    now?: Date;
  }): Promise<{ id: string; scheduledAt: Date; scheduledEndAt: Date; status: string; timezone: string; adviserName: string }> {
    const sessionType: BookingSessionType = 'FREE_15';
    const now = params.now ?? new Date();

    const slotStart = new Date(params.slotStartUtc);
    if (isNaN(slotStart.getTime())) throw new BadRequestException('Invalid slotStartUtc');

    // Re-derive the adviser's currently-available slots and require the
    // requested one to be present — defends against booking outside hours,
    // inside the 24h lead window, or a stale slot the client cached.
    const windowEnd = new Date(slotStart.getTime() + 2 * 86_400_000);
    const avail = await this.getAvailableSlots({
      adviserId: params.adviserId, sessionType, dateFrom: new Date(now.getTime() - 60_000), dateTo: windowEnd, now,
    });
    const match = avail.slots.find((s) => s.start.getTime() === slotStart.getTime());
    if (!match) {
      throw new ConflictException('That time was just taken — please pick another slot');
    }

    const adviser = await this.prisma.user.findUnique({ where: { id: params.adviserId }, select: { name: true } });
    const leadId = await this.resolveOrCreateLeadForUser(params.userId);

    // Create the booking row, then commit it onto the slot (the commit
    // guard + partial unique index enforce no double-booking).
    const consultation = await this.prisma.consultation.create({
      data: {
        leadId,
        type: 'FREE_15',
        amountNZD: 0,
        paymentStatus: 'PAID', // free → nothing to collect
        assignedToId: params.adviserId,
        status: 'PENDING',
      },
      select: { id: true },
    });

    const committed = await this.commitBooking({
      consultationId: consultation.id,
      adviserId: params.adviserId,
      sessionType,
      slotStart,
      timezone: avail.timezone,
      confirm: true,
    });

    return {
      id: committed.id,
      scheduledAt: committed.scheduledAt,
      scheduledEndAt: committed.scheduledEndAt,
      status: committed.status,
      timezone: avail.timezone,
      adviserName: adviser?.name ?? 'Your adviser',
    };
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
