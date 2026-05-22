import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WixSecretGuard } from './guards/wix-secret.guard';
import { WixWebhooksService } from './wix-webhooks.service';
import type { WixLeadCaptureBody } from './dto/wix-lead-capture.dto';

// PR-WIX-1 — Public Wix lead-capture webhook.
//
// No JwtAuthGuard. Authentication is the shared-secret header
// validated by WixSecretGuard; rate limit comes from a route-level
// @Throttle override (60/min/IP, matching the global default but
// explicit so it's visible at the call site).
//
// Always responds 200 on partial-data success — Wix retries on 5xx
// and we don't want infinite-retry storms. Bad payloads come back
// 400 (with `{ status: 'error' }`), bad secret → 401, rate-limited
// → 429 from the throttler.
@Controller('api/webhooks/wix')
export class WixWebhooksController {
  constructor(private readonly service: WixWebhooksService) {}

  @Post('lead-capture')
  @UseGuards(WixSecretGuard)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async leadCapture(@Body() body: WixLeadCaptureBody) {
    const result = await this.service.processCapture(body);
    if (result.status === 'invalid') {
      throw new HttpException(
        { status: 'error', error: 'INVALID_PAYLOAD', message: result.error },
        HttpStatus.BAD_REQUEST,
      );
    }
    return result;
  }
}
