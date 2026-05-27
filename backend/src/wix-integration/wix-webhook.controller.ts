import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseFilters,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WixPaymentsService } from './wix-payments.service';
import { WixWebhookExceptionFilter } from '../webhooks/wix/wix-webhooks-exception.filter';

// PR-SCORECARD-4 — Public Wix payment webhook.
//
// POST /webhooks/wix/payment
//
// Authentication is the shared-secret header X-Sorena-Webhook-Secret,
// matched against the value of PlatformSetting WIX_WEBHOOK_SECRET
// (rotatable in-place via the OWNER UI).
//
// Rate-limited to 60/min/IP via the route-level @Throttle override.
//
// Contract:
//   * Valid signature + recordable payload → 200 { status: "ok", paymentId }
//   * Missing / invalid secret               → 401 { error: "invalid_signature" }
//   * Anything else (malformed payload, DB error) → 500 + console.error
//
// The path is deliberately `/webhooks/wix/payment` (no `api/` prefix)
// to match the PR-SCORECARD-4 spec. The pre-existing PR-WIX-1
// lead-capture controller uses `/api/webhooks/wix/lead-capture` —
// both routes coexist, since they live under different controllers.

@Controller('webhooks/wix')
@UseFilters(WixWebhookExceptionFilter)
export class WixWebhookController {
  private readonly logger = new Logger(WixWebhookController.name);

  constructor(private readonly payments: WixPaymentsService) {}

  @Post('payment')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async payment(
    @Body() body: any,
    @Headers('x-sorena-webhook-secret') headerSecret: string | undefined,
    @Req() req: any,
  ) {
    const ip = extractIp(req);
    try {
      const result = await this.payments.recordPayment(body ?? {}, headerSecret, ip);
      return {
        status: 'ok',
        paymentId: result.id,
        wixPaymentId: result.wixPaymentId,
      };
    } catch (err) {
      if (err instanceof HttpException) {
        // Surface the structured error to Wix verbatim. 401 means
        // invalid signature — Wix sees `{ error: "invalid_signature" }`
        // and stops retrying.
        const status = err.getStatus();
        if (status === HttpStatus.UNAUTHORIZED) {
          throw new HttpException(
            { error: 'invalid_signature' },
            HttpStatus.UNAUTHORIZED,
          );
        }
        throw err;
      }
      // Truly unexpected — log the full payload so the OWNER can
      // diagnose. Returning 500 makes Wix retry, which is what we
      // want for genuine server errors.
      this.logger.error(
        `[wix-payment-webhook] unhandled error from ${ip}: ${(err as Error).message}`,
        err instanceof Error ? err.stack : String(err),
      );
      // eslint-disable-next-line no-console
      console.error('[wix-payment-webhook] raw payload:', JSON.stringify(body));
      throw new HttpException(
        { error: 'internal_error' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

function extractIp(req: any): string | null {
  const fwd = req?.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req?.ip ?? req?.connection?.remoteAddress ?? null;
}
