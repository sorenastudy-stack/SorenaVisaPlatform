import { Controller, Get, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

// PR-DASH-3 — Booking config endpoint.
//
// Backends owns the WIX_BOOKING_URL env var (kept off the client
// bundle so unauthenticated visitors can't scrape it). The
// dashboard's BookMeetingButton calls this endpoint to decide
// whether to render an enabled button. Returns null when the env
// var is unset or empty.
@Controller('api/student/booking-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
export class BookingConfigController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  get() {
    const raw = this.config.get<string>('WIX_BOOKING_URL') ?? '';
    return { wixBookingUrl: raw.trim() === '' ? null : raw.trim() };
  }
}
