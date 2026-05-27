import { Controller, Get } from '@nestjs/common';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

// PR-SCORECARD-4 — Public booking-URL resolver.
//
// GET /scorecard/booking-urls — no auth required.
//
// Returns the three OWNER-editable booking URLs (Free 15-min, NZD 30
// Gap-Closing, NZD 150 LIA) that the public result page reads at
// render time. The frontend caches the response so a network blip
// during navigation doesn't break the booking button — but every
// call lands on a server-side cache too (60s TTL) so a flood of
// scorecard completions doesn't hammer the DB.

const CACHE_TTL_MS = 60_000;

interface BookingUrlsOut {
  FREE_15MIN: string;
  GAP_CLOSING_PAYMENT: string;
  LIA_CONSULTATION: string;
}

@Controller('scorecard')
export class ScorecardPublicController {
  private cached: { value: BookingUrlsOut; expiresAt: number } | null = null;

  constructor(private readonly settings: PlatformSettingsService) {}

  @Get('booking-urls')
  async bookingUrls(): Promise<BookingUrlsOut> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) {
      return this.cached.value;
    }
    const value = await this.settings.getBookingUrls();
    this.cached = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  }
}
