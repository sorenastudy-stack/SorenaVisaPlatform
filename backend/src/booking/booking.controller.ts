import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BookingService } from './booking.service';
import { SlotsQueryDto, ConfirmBookingDto } from './dto/booking.dto';

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
  constructor(private readonly service: BookingService) {}

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

  // POST /booking/confirm  { type:'FREE_15', adviserId, slotStartUtc }
  // Creates + confirms the booking for the signed-in client. 409 if the
  // slot was taken between listing and confirming.
  @Post('confirm')
  async confirm(@Body() dto: ConfirmBookingDto, @Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    const booking = await this.service.createFreeBooking({
      userId,
      slotStartUtc: dto.slotStartUtc,
      preferredAdviserId: dto.adviserId,
    });
    return booking;
  }

  // GET /booking/mine — the signed-in client's upcoming bookings.
  @Get('mine')
  async mine(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.getMyUpcomingBookings(userId);
  }
}
