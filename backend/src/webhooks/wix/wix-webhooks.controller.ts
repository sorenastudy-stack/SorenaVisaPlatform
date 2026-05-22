import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WixSecretGuard } from './guards/wix-secret.guard';
import { WixWebhooksService } from './wix-webhooks.service';
import { WixWebhookExceptionFilter } from './wix-webhooks-exception.filter';
import type { WixLeadCaptureBody } from './dto/wix-lead-capture.dto';

// PR-WIX-1 — Public Wix lead-capture webhook.
//
// No JwtAuthGuard. Authentication is the shared-secret header
// validated by WixSecretGuard; rate limit comes from a route-level
// @Throttle override (60/min/IP, matching the global default but
// explicit so it's visible at the call site).
//
// `@HttpCode(200)` overrides NestJS's default 201-for-POST so the
// success / duplicate paths match the Wix contract: Wix retries
// only on 5xx, so we deliberately return 2xx for any case we want
// to treat as terminal — including dedupe.
//
// `@UseFilters(WixWebhookExceptionFilter)` overrides the global
// `HttpExceptionFilter` (which flattens `{ status, error }` payloads
// into `{ statusCode, message, timestamp }`) so the Wix contract's
// structured error bodies survive. The filter is route-scoped so no
// other endpoint's error response shape is affected.
@Controller('api/webhooks/wix')
@UseFilters(WixWebhookExceptionFilter)
export class WixWebhooksController {
  constructor(private readonly service: WixWebhooksService) {}

  @Post('lead-capture')
  @HttpCode(HttpStatus.OK)
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
