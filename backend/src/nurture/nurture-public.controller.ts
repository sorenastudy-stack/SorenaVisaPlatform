import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { NurtureService } from './nurture.service';
import { UnsubscribeDto } from './dto/nurture.dto';

// PR-NURTURE — public unsubscribe. No auth: the per-lead token IS the
// authorization. A POST (not a GET) so email-scanner link prefetching can't
// silently unsubscribe someone — the frontend /unsubscribe page confirms, then
// POSTs here. Rate-limited to blunt token brute-forcing.
@Controller('nurture')
export class NurturePublicController {
  constructor(private readonly nurture: NurtureService) {}

  // POST /nurture/unsubscribe — { token }. Permanent + idempotent.
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('unsubscribe')
  unsubscribe(@Body() dto: UnsubscribeDto) {
    return this.nurture.unsubscribe(dto.token);
  }
}
