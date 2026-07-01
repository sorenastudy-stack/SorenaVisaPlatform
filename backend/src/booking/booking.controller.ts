import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BookingService } from './booking.service';
import { StripeService } from '../payments/stripe.service';
import { getSessionConfig } from './session-config';
import {
  SlotsQueryDto, ConfirmBookingDto, HoldBookingDto, CheckoutBookingDto,
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
  ) {}

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

  // POST /booking/checkout  { consultationId }
  // Creates a Stripe Checkout session for a held (PENDING, live) GAP slot.
  @Post('checkout')
  async checkout(@Body() dto: CheckoutBookingDto, @Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    const hold = await this.service.getHoldForCheckout(userId, dto.consultationId);
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

  // GET /booking/free-eligibility — has the client already used their one
  // free 15-min session? Lets the free-booking page show the "already
  // used" state up front instead of after a rejected confirm.
  @Get('free-eligibility')
  async freeEligibility(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    const used = await this.service.hasUsedFreeSession(userId);
    return { used };
  }
}
