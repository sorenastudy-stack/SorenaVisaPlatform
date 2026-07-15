import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BookingService } from './booking.service';
import { BookingEligibilityService } from './booking-eligibility.service';
import { StripeService } from '../payments/stripe.service';
import { PolicyAcceptanceService } from '../wallet/policy-acceptance.service';
import { BookingCancellationService } from './booking-cancellation.service';
import { getSessionConfig, SESSION_TYPES } from './session-config';
import {
  SlotsQueryDto, ConfirmBookingDto, HoldBookingDto, CheckoutBookingDto, PayWithWalletDto,
} from './dto/booking.dto';

// PR-BOOKING-3 — client booking endpoints (Stage 3: FREE_15 flow).
//
// Class-level guards mirror the portal: JwtAuthGuard + RolesGuard, gated
// to LEAD/STUDENT. The acting client is ALWAYS the JWT user
// (req.user.userId) — never trusted from the request body. The body only
// carries the chosen adviser + slot.

@Controller('booking')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LEAD', 'STUDENT')
export class BookingController {
  constructor(
    private readonly service: BookingService,
    private readonly stripe: StripeService,
    private readonly policyAcceptance: PolicyAcceptanceService,
    private readonly cancellation: BookingCancellationService,
    private readonly eligibility: BookingEligibilityService,
  ) {}

  // GET /booking/eligibility — per-type booking eligibility for the ACTING
  // client only (never accepts a userId param). Live: reconciles band + live
  // hard-stop + booking-flow gates. Tighter throttle on top of the global
  // baseline (cross-model read).
  @Get('eligibility')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  getEligibility(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.eligibility.getEligibility(userId);
  }

  // GET /booking/session-types — the session catalogue (type, price, currency)
  // for STAFF display surfaces (e.g. platform-settings titles), single-sourced
  // from backend session-config. Method-level @Roles overrides the class-level
  // LEAD/STUDENT gate (RolesGuard reads the handler's roles first). Read-only,
  // rate-limited. Currency is NZD in Step 1; Step 2 sources it from config.
  @Get('session-types')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'OPERATIONS')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  sessionTypes() {
    return Object.values(SESSION_TYPES).map((c) => ({
      type: c.type,
      price: c.priceNZD,
      currency: 'NZD',
      label: c.label,
    }));
  }

  // GET /booking/slots?type=FREE_15&from=ISO&to=ISO
  // Available slots across the type's adviser pool (UTC + adviser tz).
  @Get('slots')
  async slots(@Query() q: SlotsQueryDto) {
    return this.service.getSlotsForType({
      sessionType: q.type,
      dateFrom: new Date(q.from),
      dateTo: new Date(q.to),
    });
  }

  // POST /booking/confirm  { type:'FREE_15', staffId, slotStartUtc }
  // Creates + confirms the booking for the signed-in client. 409 if the
  // slot was taken between listing and confirming.
  @Post('confirm')
  async confirm(@Body() dto: ConfirmBookingDto, @Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    const booking = await this.service.createFreeBooking({
      userId,
      slotStartUtc: dto.slotStartUtc,
      preferredStaffId: dto.staffId,
    });
    return booking;
  }

  // GET /booking/mine — the signed-in client's upcoming bookings.
  @Get('mine')
  async mine(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.getMyUpcomingBookings(userId);
  }

  // POST /booking/hold  { type:'GAP_CLOSING', slotStartUtc, staffId? }
  // Reserves the slot (PENDING + 15-min hold) so the client can pay.
  @Post('hold')
  async hold(@Body() dto: HoldBookingDto, @Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.createHold({
      userId,
      sessionType: dto.type,
      slotStartUtc: dto.slotStartUtc,
      preferredStaffId: dto.staffId,
    });
  }

  // POST /booking/checkout  { consultationId, accepted }
  // Creates a Stripe Checkout session for a held (PENDING, live) GAP slot.
  // PR-WALLET slice 1: the client must accept the cancellation/refund policy
  // first; we record proof (IP/UA/version) BEFORE creating the Stripe session.
  @Post('checkout')
  async checkout(@Body() dto: CheckoutBookingDto, @Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    if (dto.accepted !== true) {
      throw new BadRequestException('You must accept the cancellation & refund policy to continue.');
    }
    // Validate ownership + that the hold is still payable BEFORE recording.
    const hold = await this.service.getHoldForCheckout(userId, dto.consultationId);
    const fwd = req.headers?.['x-forwarded-for'];
    const ipAddress = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.ip || null;
    await this.policyAcceptance.record({
      userId,
      consultationId: hold.id,
      ipAddress,
      userAgent: req.headers?.['user-agent'] ?? null,
    });
    const cfg = getSessionConfig(hold.type);
    const session = await this.stripe.createBookingCheckoutSession({
      consultationId: hold.id,
      leadId: hold.leadId,
      bookingType: hold.type,
      amountCents: Math.round(hold.amountNZD * 100),
      productName: `Sorena Visa — ${cfg.label}`,
    });
    return { url: session.url };
  }

  // POST /booking/pay-with-wallet  { consultationId, accepted }
  // PR-WALLET slice 3 — settle a held paid booking from wallet credit (full
  // amount only; no Stripe). Records the SAME policy acceptance as /checkout
  // BEFORE debiting, then confirms atomically. Returns the booking + new
  // balance with no redirect. If the wallet doesn't cover the price the debit
  // is refused (400) and the client falls back to card.
  @Post('pay-with-wallet')
  async payWithWallet(@Body() dto: PayWithWalletDto, @Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    if (dto.accepted !== true) {
      throw new BadRequestException('You must accept the cancellation & refund policy to continue.');
    }
    // Validate ownership + that the hold is still payable BEFORE recording.
    const hold = await this.service.getHoldForCheckout(userId, dto.consultationId);
    const fwd = req.headers?.['x-forwarded-for'];
    const ipAddress = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.ip || null;
    await this.policyAcceptance.record({
      userId,
      consultationId: hold.id,
      ipAddress,
      userAgent: req.headers?.['user-agent'] ?? null,
    });
    return this.service.payHeldBookingWithWallet(userId, hold.id);
  }

  // GET /booking/free-eligibility — has the client already used their one
  // free 15-min session? Lets the free-booking page show the "already
  // used" state up front instead of after a rejected confirm.
  @Get('free-eligibility')
  async freeEligibility(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    const used = await this.service.hasUsedFreeSession(userId);
    return { used };
  }

  // GET /booking/:id/cancel-preview — the tier + wallet credit the client
  // would get by cancelling NOW (authoritative; same math as the cancel).
  @Get(':id/cancel-preview')
  cancelPreview(@Param('id') id: string, @Req() req: any) {
    return this.cancellation.previewClientCancel(req.user?.userId ?? req.user?.id, id);
  }

  // POST /booking/:id/cancel — client self-cancel of an UPCOMING booking.
  // Posts the tiered wallet credit + flips the booking to CANCELLED atomically.
  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Req() req: any) {
    return this.cancellation.clientCancel(req.user?.userId ?? req.user?.id, id);
  }
}
