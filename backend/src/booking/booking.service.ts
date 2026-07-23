import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { generateClientId } from '../leads/client-id';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BookingSessionType,
  getSessionConfig,
  BOOKING_HOLD_MINUTES,
} from './session-config';
import { cardChargeForHeld } from './session-pricing';
import {
  computeAvailableSlots,
  AvailableSlot,
  WeeklyWindow,
  BusyInterval,
  zonedDateParts,
} from './slot-engine';
import { BookingConfirmationService } from './booking-confirmation.service';
import { WalletService } from '../wallet/wallet.service';
import { BookingEligibilityService } from './booking-eligibility.service';

// PR-BOOKING-1 — booking service (Stage 1+2: data loading + slot engine +
// commit guard). No controller/endpoints yet — that's the next stage.

export interface SlotQuery {
  staffId: string;
  sessionType: BookingSessionType;
  dateFrom: Date;
  dateTo: Date;
  now?: Date; // injectable for tests; defaults to new Date()
}

export interface SlotResult {
  staffId: string;
  timezone: string;
  sessionType: BookingSessionType;
  durationMinutes: number;
  slots: AvailableSlot[];
}

// Booking lifecycle states that occupy an adviser's time. PENDING is
// included only while a soft hold is live (holdExpiresAt > now).
const ACTIVE_BOOKING_STATUSES = ['BOOKED', 'CONFIRMED'] as const;

// StaffLeave statuses that remove days from NEW-booking availability.
// PR-BOOKING-ADMIN-B slice 2: a PENDING request (status REQUESTED) blocks
// new bookings the moment it's raised — exactly like an APPROVED leave —
// so nobody can book those days while a decision is pending. REJECTED /
// CANCELLED are excluded, so a rejected/withdrawn request reopens the days
// automatically. (This never touches EXISTING confirmed bookings.)
const LEAVE_BLOCKS_BOOKING = ['APPROVED', 'REQUESTED'] as const;

/**
 * Expand an inclusive YYYY-MM-DD range into its calendar-day keys, clipped
 * to [clipFrom, clipTo] (also YYYY-MM-DD). Used to turn APPROVED adviser
 * leave into the slot engine's `excludedDates` set. Pure calendar math: we
 * parse each date as UTC midnight and step 24h — UTC has no DST so this
 * never skips/duplicates a day, and toISOString() yields the same zero-
 * padded YYYY-MM-DD the engine derives via zonedDateParts.
 */
function expandYmdRange(start: string, end: string, clipFrom: string, clipTo: string): string[] {
  // Lexical comparison is valid for zero-padded YYYY-MM-DD.
  const lo = start > clipFrom ? start : clipFrom;
  const hi = end < clipTo ? end : clipTo;
  if (lo > hi) return [];
  const out: string[] = [];
  let t = new Date(`${lo}T00:00:00Z`).getTime();
  const endT = new Date(`${hi}T00:00:00Z`).getTime();
  if (isNaN(t) || isNaN(endT)) return out;
  // Safety bound: a single query window is never more than ~2 years.
  for (let guard = 0; t <= endT && guard < 800; guard++) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingConfirmation: BookingConfirmationService,
    private readonly wallet: WalletService,
    private readonly eligibility: BookingEligibilityService,
  ) {}

  /**
   * Verify an adviser is eligible for a session type. LIA sessions require
   * a User(role=LIA) with a verified LiaProfile. Throws otherwise.
   */
  async assertStaffEligible(staffId: string, sessionType: BookingSessionType): Promise<void> {
    const cfg = getSessionConfig(sessionType);
    if (!cfg.requiresLia) return;

    const adviser = await this.prisma.user.findUnique({
      where: { id: staffId },
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
  async listEligibleLiaStaff(): Promise<Array<{ id: string; name: string }>> {
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
   * The adviser pool for a session type (PR-BOOKING-ADMIN-A tightened).
   * An adviser is in the pool iff they are: active, booking-active, have
   * the type in `bookableSessionTypes`, AND have ≥1 active availability
   * window. For LIA sessions they must additionally be role LIA with a
   * verified LiaProfile. This makes the pool explicit + admin-controlled
   * (configured via /staff/team) rather than role-inferred.
   */
  async listStaffForType(sessionType: BookingSessionType): Promise<Array<{ id: string; name: string }>> {
    const cfg = getSessionConfig(sessionType);
    const where: Prisma.UserWhereInput = {
      isActive: true,
      bookingActive: true,
      bookableSessionTypes: { has: sessionType as any },
      staffAvailability: { some: { active: true } },
    };
    if (cfg.requiresLia) {
      where.role = 'LIA';
      where.liaProfile = { iaaLicenceVerifiedAt: { not: null } };
    }
    return this.prisma.user.findMany({
      where,
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
   * carries the list of free staffIds so the confirm step can assign
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
    slots: Array<{ startUtc: string; endUtc: string; remaining: number; availableStaffIds: string[] }>;
  }> {
    const { sessionType, dateFrom, dateTo } = params;
    const now = params.now ?? new Date();
    const cfg = getSessionConfig(sessionType);

    const advisers = await this.listStaffForType(sessionType);
    let timezone = 'Pacific/Auckland';
    // start instant → { endUtc, availableStaffIds[] }. We ACCUMULATE
    // every free adviser at that time (no dedup) — that list size is the
    // capacity.
    const byStart = new Map<string, { startUtc: string; endUtc: string; availableStaffIds: string[] }>();

    for (const adviser of advisers) {
      const res = await this.getAvailableSlots({ staffId: adviser.id, sessionType, dateFrom, dateTo, now });
      if (res.slots.length > 0) timezone = res.timezone;
      for (const s of res.slots) {
        const key = s.start.toISOString();
        const entry = byStart.get(key);
        if (entry) {
          entry.availableStaffIds.push(adviser.id);
        } else {
          byStart.set(key, { startUtc: key, endUtc: s.end.toISOString(), availableStaffIds: [adviser.id] });
        }
      }
    }

    const slots = [...byStart.values()]
      .map((e) => ({
        startUtc: e.startUtc,
        endUtc: e.endUtc,
        remaining: e.availableStaffIds.length,
        availableStaffIds: e.availableStaffIds,
      }))
      // A time with no free adviser simply never made it into the map, so
      // every entry here already has remaining >= 1.
      .sort((a, b) => a.startUtc.localeCompare(b.startUtc));

    return { sessionType, durationMinutes: cfg.durationMinutes, timezone, slots };
  }

  /**
   * The pool advisers free at one exact start time (capacity helper).
   * Reuses getSlotsForType over a tight window so 24h-lead / working-hours
   * / busy filtering all apply identically. Returns the free staffIds in
   * pool order plus the resolved timezone.
   */
  private async availableStaffAt(
    sessionType: BookingSessionType, slotStart: Date, now: Date,
  ): Promise<{ staffIds: string[]; timezone: string }> {
    const cfg = getSessionConfig(sessionType);
    const dateFrom = new Date(slotStart.getTime() - 60_000);
    const dateTo = new Date(slotStart.getTime() + cfg.durationMinutes * 60_000 + 60_000);
    const res = await this.getSlotsForType({ sessionType, dateFrom, dateTo, now });
    const entry = res.slots.find((s) => s.startUtc === slotStart.toISOString());
    return { staffIds: entry?.availableStaffIds ?? [], timezone: res.timezone };
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
      // PR-CLIENT-ID — permanent human-readable id (country from the contact).
      const clientId = await generateClientId(tx, { contactId: contact.id });
      const lead = await tx.lead.create({ data: { clientId, contactId: contact.id }, select: { id: true } });
      return lead.id;
    });
  }

  /**
   * Whether this client has already used their one free 15-min session.
   * "Used" = any FREE_15 consultation that isn't cancelled (booked,
   * confirmed, completed, no-show all count). Paid types are never
   * limited — this only governs FREE_15.
   */
  async hasUsedFreeSession(userId: string): Promise<boolean> {
    const count = await this.prisma.consultation.count({
      where: {
        type: 'FREE_15',
        status: { not: 'CANCELLED' },
        lead: { contact: { userId } },
      },
    });
    return count > 0;
  }

  // ── PAID BOOKING: hold + checkout (PR-BOOKING-4, GAP_CLOSING slice) ────

  /** Cancel this client's own stale (expired, unpaid) PENDING holds. */
  async cancelStaleHoldsForUser(userId: string, now: Date): Promise<void> {
    await this.prisma.consultation.updateMany({
      where: {
        lead: { contact: { userId } },
        status: 'PENDING',
        paymentStatus: { not: 'PAID' },
        holdExpiresAt: { lt: now },
      },
      data: { status: 'CANCELLED' },
    });
  }

  /**
   * Create a HELD slot for a paid session. Capacity-aware: assigns a free
   * adviser at the slot (preferred first), with a transactional re-check
   * against overlapping active bookings AND other live holds, then writes
   * a PENDING consultation with holdExpiresAt = now + BOOKING_HOLD_MINUTES.
   * The slot engine counts this hold as busy until it expires. 409 if no
   * adviser is free.
   */
  async createHold(params: {
    userId: string;
    sessionType: BookingSessionType;
    slotStartUtc: string;
    preferredStaffId?: string;
    now?: Date;
  }): Promise<{
    consultationId: string; holdExpiresAt: Date; amountNZD: number;
    currency: string; cardFeeCents: number; cardTotalCents: number;
    type: BookingSessionType; slotStartUtc: string; staffName: string; timezone: string;
  }> {
    const { sessionType } = params;
    const cfg = getSessionConfig(sessionType);
    const now = params.now ?? new Date();

    const slotStart = new Date(params.slotStartUtc);
    if (isNaN(slotStart.getTime())) throw new BadRequestException('Invalid slotStartUtc');
    const slotEnd = new Date(slotStart.getTime() + cfg.durationMinutes * 60_000);

    // Eligibility gate (server-side) BEFORE any slot is held — an ineligible
    // GAP/LIA booking is rejected with 403 (reason) and never reserves a slot.
    await this.eligibility.assertEligible(params.userId, sessionType);

    // Release this client's own expired holds before making a new one.
    await this.cancelStaleHoldsForUser(params.userId, now);

    const { staffIds, timezone } = await this.availableStaffAt(sessionType, slotStart, now);
    if (staffIds.length === 0) {
      throw new ConflictException('That time is no longer available — please pick another slot');
    }
    const ordered = params.preferredStaffId && staffIds.includes(params.preferredStaffId)
      ? [params.preferredStaffId, ...staffIds.filter((id) => id !== params.preferredStaffId)]
      : staffIds;

    const leadId = await this.resolveOrCreateLeadForUser(params.userId);
    const holdExpiresAt = new Date(now.getTime() + BOOKING_HOLD_MINUTES * 60_000);

    for (const staffId of ordered) {
      try {
        const consult = await this.prisma.$transaction(async (tx) => {
          // Re-check: no active booking AND no other LIVE hold overlapping
          // this adviser+slot. (Holds aren't covered by the partial unique
          // index, so this app-level guard narrows the race; the confirm
          // step's index is the hard backstop.)
          const clash = await tx.consultation.findFirst({
            where: {
              assignedToId: staffId,
              scheduledAt: { not: null, lt: slotEnd },
              scheduledEndAt: { gt: slotStart },
              OR: [
                { status: { in: [...ACTIVE_BOOKING_STATUSES] } },
                { status: 'PENDING', holdExpiresAt: { gt: now } },
              ],
            },
            select: { id: true },
          });
          if (clash) throw new ConflictException('taken');

          // Defense-in-depth (PR-BOOKING-ADMIN-B): no holds on an APPROVED
          // leave day either (the engine already hides it; this blocks a
          // hand-crafted slotStart).
          const slotYmd = zonedDateParts(slotStart, timezone).key;
          const onLeave = await tx.staffLeave.findFirst({
            where: { staffId, status: { in: [...LEAVE_BLOCKS_BOOKING] }, startDate: { lte: slotYmd }, endDate: { gte: slotYmd } },
            select: { id: true },
          });
          if (onLeave) throw new ConflictException('taken');

          return tx.consultation.create({
            data: {
              leadId,
              type: sessionType as any,
              // amountNZD is the legacy column name; it now holds the BASE price
              // in `currency` (USD). Currency is stamped at hold time so the
              // later charge honours what was quoted, not a re-read of config.
              amountNZD: cfg.price,
              currency: cfg.currency,
              paymentStatus: 'PENDING',
              status: 'PENDING',
              assignedToId: staffId,
              scheduledAt: slotStart,
              scheduledEndAt: slotEnd,
              durationMinutes: cfg.durationMinutes,
              bookingTimezone: timezone,
              holdExpiresAt,
            },
            select: { id: true },
          });
        });

        const adviser = await this.prisma.user.findUnique({ where: { id: staffId }, select: { name: true } });
        const holdCharge = cardChargeForHeld(Math.round(cfg.price * 100));
        return {
          consultationId: consult.id,
          holdExpiresAt,
          amountNZD: cfg.price,
          currency: cfg.currency,
          cardFeeCents: holdCharge.cardFeeCents,
          cardTotalCents: holdCharge.cardTotalCents,
          type: sessionType,
          slotStartUtc: slotStart.toISOString(),
          staffName: adviser?.name ?? 'Your adviser',
          timezone,
        };
      } catch (e) {
        if (e instanceof ConflictException) continue; // adviser taken — try next
        throw e;
      }
    }
    throw new ConflictException('That time is no longer available — please pick another slot');
  }

  /**
   * Validate a held consultation is payable by this client and return the
   * fields the controller needs to build the Stripe Checkout session.
   * 409 if already paid/confirmed or the hold expired.
   */
  async getHoldForCheckout(userId: string, consultationId: string, now: Date = new Date()): Promise<{
    id: string; leadId: string; type: BookingSessionType; amountNZD: number; currency: string;
  }> {
    const c = await this.prisma.consultation.findFirst({
      where: { id: consultationId, lead: { contact: { userId } } },
      select: { id: true, leadId: true, type: true, status: true, paymentStatus: true, holdExpiresAt: true, amountNZD: true, currency: true },
    });
    if (!c) throw new NotFoundException('Hold not found');
    if (c.type !== 'GAP_CLOSING' && c.type !== 'LIA') {
      throw new BadRequestException('This booking type is not payable yet');
    }
    if (c.status === 'CONFIRMED' || c.paymentStatus === 'PAID') {
      throw new ConflictException('This booking is already paid');
    }
    if (c.status !== 'PENDING' || !c.holdExpiresAt || c.holdExpiresAt <= now) {
      throw new ConflictException('Your hold expired — please pick a time again');
    }
    return { id: c.id, leadId: c.leadId, type: c.type as BookingSessionType, amountNZD: c.amountNZD, currency: c.currency };
  }

  /**
   * PR-WALLET slice 3 — settle a held paid booking from the client's wallet
   * (FULL amount only; the caller has already recorded policy acceptance).
   *
   * One atomic transaction: re-check the hold is still payable, re-check the
   * slot wasn't taken, debit the wallet (SPEND_BOOKING, which locks the wallet
   * row and refuses a negative balance), and flip the consultation to
   * CONFIRMED / PAID / paidWith=WALLET. All-or-nothing — never a debit without
   * a confirm, never a confirm without a debit. `wallet_transaction_spend_once_idx`
   * is the double-checkout backstop (P2002 → 409). No Stripe involved.
   *
   * Insufficient balance → 400; lost slot / expired hold / already paid → 409.
   */
  async payHeldBookingWithWallet(
    userId: string,
    consultationId: string,
    now: Date = new Date(),
  ): Promise<{ status: 'CONFIRMED'; paidWith: 'WALLET'; newBalanceCents: number }> {
    // Ownership + still-payable checks BEFORE touching money (404 / 409 / 400).
    const hold = await this.getHoldForCheckout(userId, consultationId, now);
    // Wallet pays the BASE (no card fee), in the HOLD's currency — never a
    // re-read of config, so an in-flight hold settles at what it was quoted.
    const priceCents = Math.round(hold.amountNZD * 100);
    if (priceCents <= 0) throw new BadRequestException('This booking is not payable.');

    // Option-A currency guard: refuse to debit a wallet whose currency differs
    // from the session's — that would silently mix units. Card still works.
    const wallet = await this.prisma.wallet.findUnique({ where: { userId }, select: { currency: true } });
    if (wallet && wallet.currency !== hold.currency) {
      throw new BadRequestException(
        `Your wallet is held in ${wallet.currency}, but this session is priced in ${hold.currency}. Please pay by card instead.`,
      );
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Re-load inside the tx — must still be a live, unpaid hold.
        const fresh = await tx.consultation.findUnique({
          where: { id: consultationId },
          select: {
            status: true, paymentStatus: true, holdExpiresAt: true,
            assignedToId: true, scheduledAt: true, scheduledEndAt: true,
          },
        });
        if (!fresh) throw new NotFoundException('Hold not found');
        if (fresh.status === 'CONFIRMED' || fresh.paymentStatus === 'PAID') {
          throw new ConflictException('This booking is already paid');
        }
        if (fresh.status !== 'PENDING' || !fresh.holdExpiresAt || fresh.holdExpiresAt <= now) {
          throw new ConflictException('Your hold expired — please pick a time again');
        }

        // Slot-clash re-check: a card booking may have confirmed this
        // adviser+slot while the hold sat here. Wallet payment is synchronous,
        // so on a clash we abort the whole tx — nothing is debited.
        if (fresh.assignedToId && fresh.scheduledAt && fresh.scheduledEndAt) {
          const clash = await tx.consultation.findFirst({
            where: {
              assignedToId: fresh.assignedToId,
              id: { not: consultationId },
              status: { in: ['BOOKED', 'CONFIRMED'] },
              scheduledAt: { not: null, lt: fresh.scheduledEndAt },
              scheduledEndAt: { gt: fresh.scheduledAt },
            },
            select: { id: true },
          });
          if (clash) throw new ConflictException('That time was just taken — please pick another slot.');
        }

        // Debit (locks the wallet row; throws 400 if balance < priceCents).
        const debit = await this.wallet.debit({
          userId,
          amountCents: priceCents,
          type: 'SPEND_BOOKING',
          createdById: userId,
          reason: `${hold.type} booking — paid with wallet credit`,
          relatedConsultationId: consultationId,
        }, tx);

        await tx.consultation.update({
          where: { id: consultationId },
          data: { status: 'CONFIRMED', paymentStatus: 'PAID', paidWith: 'WALLET', holdExpiresAt: null },
        });
        return { newBalanceCents: debit.balanceCents };
      });

      // Best-effort finalize (Jitsi link + email), same as the card path.
      await this.bookingConfirmation.onConfirmed(consultationId).catch(() => undefined);
      this.logger.log(`Booking ${consultationId} confirmed via wallet credit (${priceCents}c) for user ${userId}`);
      return { status: 'CONFIRMED', paidWith: 'WALLET', newBalanceCents: result.newBalanceCents };
    } catch (e) {
      // Double-checkout backstop: spend-once index rejected a 2nd SPEND_BOOKING.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This booking is already paid');
      }
      throw e;
    }
  }

  /**
   * Create + confirm a FREE_15 booking for the signed-in client, capacity-
   * aware. The client supplies only the start time (the LEAD identity comes
   * from the JWT, never the body); the server assigns one of the advisers
   * free at that time.
   *
   * Capacity behaviour: we compute the advisers free at the time and try
   * to commit to each in turn (first free first; an optional
   * preferredStaffId is tried first when still free). The per-adviser
   * commit guard + partial unique index prevent two clients getting the
   * SAME adviser at the same time — so on a race we just move to the next
   * free adviser. Only when EVERY adviser at that time is taken do we 409.
   * This means two clients CAN both book 9am when two advisers are free.
   */
  async createFreeBooking(params: {
    userId: string;
    slotStartUtc: string;
    preferredStaffId?: string;
    now?: Date;
  }): Promise<{ id: string; scheduledAt: Date; scheduledEndAt: Date; status: string; timezone: string; staffName: string }> {
    const sessionType: BookingSessionType = 'FREE_15';
    const now = params.now ?? new Date();

    const slotStart = new Date(params.slotStartUtc);
    if (isNaN(slotStart.getTime())) throw new BadRequestException('Invalid slotStartUtc');

    // Eligibility gate (server-side, cannot be bypassed by the UI). Reconciles
    // band + LIVE hard-stop + free-once and throws ForbiddenException(reason)
    // → 403, distinct from the 409 slot-taken path below.
    await this.eligibility.assertEligible(params.userId, sessionType);

    // Free-once rule: one FREE_15 per client, ever. Kept as a backstop even
    // though assertEligible already covers it (defense in depth).
    if (await this.hasUsedFreeSession(params.userId)) {
      throw new ForbiddenException(
        "You've already used your free consultation. Please choose a paid session to continue.",
      );
    }

    // Advisers free at this exact time (inside hours, ≥24h lead, not busy).
    const { staffIds, timezone } = await this.availableStaffAt(sessionType, slotStart, now);
    if (staffIds.length === 0) {
      throw new ConflictException('That time was just taken — please pick another slot');
    }

    // Try the preferred adviser first (if still free), then the rest in
    // pool order. "First free" assignment — noted as the simple policy;
    // least-loaded could replace this later.
    const ordered = params.preferredStaffId && staffIds.includes(params.preferredStaffId)
      ? [params.preferredStaffId, ...staffIds.filter((id) => id !== params.preferredStaffId)]
      : staffIds;

    const leadId = await this.resolveOrCreateLeadForUser(params.userId);

    // One PENDING booking row, reused across adviser retries (commitBooking
    // overwrites assignedToId each attempt). Avoids orphan rows on a race.
    const consultation = await this.prisma.consultation.create({
      data: {
        leadId,
        type: 'FREE_15',
        amountNZD: 0,
        currency: getSessionConfig('FREE_15').currency, // stamp currency even at $0
        paymentStatus: 'PAID', // free → nothing to collect
        status: 'PENDING',
      },
      select: { id: true },
    });

    for (const staffId of ordered) {
      try {
        const committed = await this.commitBooking({
          consultationId: consultation.id,
          staffId,
          sessionType,
          slotStart,
          timezone,
          confirm: true,
        });
        const adviser = await this.prisma.user.findUnique({ where: { id: staffId }, select: { name: true } });
        // PR-BOOKING-5 — finalize (Jitsi link + confirmation email).
        // Best-effort; never let it unwind the confirmed free booking.
        await this.bookingConfirmation.onConfirmed(committed.id).catch(() => undefined);
        return {
          id: committed.id,
          scheduledAt: committed.scheduledAt,
          scheduledEndAt: committed.scheduledEndAt,
          status: committed.status,
          timezone,
          staffName: adviser?.name ?? 'Your adviser',
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
    durationMinutes: number | null; timezone: string | null; staffName: string | null;
    meetingLink: string | null; status: string;
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
        durationMinutes: true, bookingTimezone: true, status: true, meetingLink: true,
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
      staffName: r.assignedTo?.name ?? null,
      meetingLink: r.meetingLink,
      status: r.status,
    }));
  }

  /**
   * Available slots for an adviser + session type over a date range.
   * Loads active weekly windows and current busy intervals, then defers
   * to the pure engine.
   */
  async getAvailableSlots(query: SlotQuery): Promise<SlotResult> {
    const { staffId, sessionType, dateFrom, dateTo } = query;
    const now = query.now ?? new Date();
    const cfg = getSessionConfig(sessionType);

    await this.assertStaffEligible(staffId, sessionType);

    // 1. Active weekly windows for the adviser.
    const availabilityRows = await this.prisma.staffAvailability.findMany({
      where: { staffId, active: true },
      select: { dayOfWeek: true, startMinute: true, endMinute: true, timezone: true },
    });
    if (availabilityRows.length === 0) {
      return { staffId, timezone: 'Pacific/Auckland', sessionType, durationMinutes: cfg.durationMinutes, slots: [] };
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
        assignedToId: staffId,
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

    // 3. APPROVED leave → excluded calendar dates (PR-BOOKING-ADMIN-B).
    //    Only APPROVED blocks; REQUESTED/REJECTED/CANCELLED never do. We
    //    load leave overlapping the query window (lexical YYYY-MM-DD bounds
    //    in the adviser's tz) and expand each to per-day keys clipped to the
    //    window. The pure engine then skips those days — the capacity/pool
    //    path inherits this automatically (it fans out per adviser here).
    const fromYmd = zonedDateParts(dateFrom, timezone).key;
    const toYmd = zonedDateParts(dateTo, timezone).key;
    const leaves = await this.prisma.staffLeave.findMany({
      where: {
        staffId,
        status: { in: [...LEAVE_BLOCKS_BOOKING] },
        startDate: { lte: toYmd },
        endDate: { gte: fromYmd },
      },
      select: { startDate: true, endDate: true },
    });
    const excludedDates = new Set<string>();
    for (const lv of leaves) {
      for (const key of expandYmdRange(lv.startDate, lv.endDate, fromYmd, toYmd)) {
        excludedDates.add(key);
      }
    }

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
      excludedDates,
    });

    return { staffId, timezone, sessionType, durationMinutes: cfg.durationMinutes, slots };
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
    staffId: string;
    sessionType: BookingSessionType;
    slotStart: Date;
    timezone: string;
    confirm?: boolean; // CONFIRMED if true (e.g. paid), else BOOKED
  }): Promise<{ id: string; scheduledAt: Date; scheduledEndAt: Date; status: string }> {
    const { consultationId, staffId, sessionType, slotStart, timezone } = params;
    const cfg = getSessionConfig(sessionType);
    const slotEnd = new Date(slotStart.getTime() + cfg.durationMinutes * 60_000);
    const nextStatus = params.confirm ? 'CONFIRMED' : 'BOOKED';

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Re-check: any active booking for this adviser overlapping the slot?
        const clash = await tx.consultation.findFirst({
          where: {
            assignedToId: staffId,
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

        // Defense-in-depth (PR-BOOKING-ADMIN-B): refuse to commit onto a day
        // the adviser has APPROVED leave for. The slot engine already hides
        // such days, so this only fires for a stale/hand-crafted request.
        const slotYmd = zonedDateParts(slotStart, timezone).key;
        const onLeave = await tx.staffLeave.findFirst({
          where: { staffId, status: { in: [...LEAVE_BLOCKS_BOOKING] }, startDate: { lte: slotYmd }, endDate: { gte: slotYmd } },
          select: { id: true },
        });
        if (onLeave) {
          throw new ConflictException('That adviser is on leave that day — please pick another slot');
        }

        const updated = await tx.consultation.update({
          where: { id: consultationId },
          data: {
            assignedToId: staffId,
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
