import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { WebinarApiKeyGuard } from './guards/webinar-api-key.guard';
import { WebinarsService } from './webinars.service';
import type { RegisterWebinarBody } from './dto/register-webinar.dto';

// PR-WEBINAR-1 — the sorenavisa.com website's webinar registration + listing
// endpoints. This is the receiving side of the website's existing (previously
// always-503ing) `/api/webinar-registration` server route.
//
// `register` is server-to-server (the website's Next.js route calls it, not the
// visitor's browser), so it is guarded by a bearer shared secret rather than
// CORS/public-form protections. `@HttpCode(200)` matches the Wix webhook
// precedent: 2xx for every terminal outcome the caller should NOT retry
// (including "already registered"), reserving non-2xx for genuine failures.
//
// Worth knowing when reading logs: the website turns ANY non-2xx from here into
// a generic 502 for the visitor, so the specific reason (bad payload, unknown
// slug, bad key) is only visible in THIS service's logs, never on the page.
//
// `list` is a plain public GET for the registration page to render upcoming
// webinars — no auth, matching the acquisition module's public endpoints.
@Controller('api/webinars')
export class WebinarsController {
  constructor(private readonly service: WebinarsService) {}

  @Get()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  list() {
    return this.service.listUpcoming();
  }

  @Post('register')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WebinarApiKeyGuard, ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async register(@Body() body: RegisterWebinarBody) {
    const result = await this.service.register(body);
    if (result.status === 'invalid') {
      throw new HttpException(
        { status: 'error', error: 'INVALID_PAYLOAD', message: result.error },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (result.status === 'not_found') {
      throw new HttpException(
        { status: 'error', error: 'WEBINAR_NOT_FOUND', message: result.error },
        HttpStatus.NOT_FOUND,
      );
    }
    return result;
  }
}
