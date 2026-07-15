import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { ScorecardService } from './scorecard.service';
import { SubmitScorecardDto } from './dto/scorecard.dto';

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

  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly scorecard: ScorecardService,
  ) {}

  // Path A — public (anonymous) scorecard submit. No auth: the service
  // resolves-or-creates a LEAD by the email in the answers. Tightly rate
  // limited (5/min/IP) since it can create login-capable accounts. The DTO
  // carries NO role — role is hardcoded LEAD server-side on create.
  //   • { mode:'created' }  → new LEAD; a "create your password" link was
  //                           emailed. NO session (client sets a password first).
  //   • { mode:'existing' } → a magic-link was emailed; no session.
  @Post('public/submit')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async publicSubmit(@Body() dto: SubmitScorecardDto, @Req() req: any) {
    const fwd = req.headers?.['x-forwarded-for'];
    const ipAddress =
      (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.ip || null;
    const userAgent = req.headers?.['user-agent'] ?? null;
    return this.scorecard.submitScorecardPublic(
      dto.answers,
      { ipAddress, userAgent },
      dto.attribution ?? {},
    );
  }

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
