import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

// PR-WIX-1 fix — Route-scoped exception filter for the Wix webhook.
//
// The global `HttpExceptionFilter` (see `common/filters/http-exception.filter.ts`)
// rewrites every error response to a uniform `{ statusCode, message,
// timestamp }` shape — convenient for most endpoints, but it strips
// the structured `{ status: 'error', error: '<code>' }` body the
// Wix webhook contract requires (Wix can read the body but won't
// retry on 4xx, so we want to surface a specific error code).
//
// Route-scoped via `@UseFilters(...)` on the controller, so this
// only applies to `/api/webhooks/wix/*` — no other endpoint is
// affected. For non-HttpException errors we still defer to the
// global filter's behaviour by emitting a 500 with a generic body,
// which keeps the operator-facing contract identical.

@Catch()
export class WixWebhookExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(WixWebhookExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // When the thrower passes a structured object (our guard +
      // controller both do), forward it verbatim. The Wix contract
      // depends on the `status` + `error` keys being preserved.
      if (typeof body === 'object' && body !== null) {
        return res.status(status).json(body);
      }

      // String body: wrap in the canonical error shape so Wix sees
      // a consistent envelope.
      return res.status(status).json({
        status: 'error',
        message: String(body),
      });
    }

    // Truly unexpected error — log + emit a generic 500. Matches
    // the global filter's fallthrough so an operator reading either
    // log stream sees the same thing.
    this.logger.error(
      'Unhandled exception in Wix webhook',
      exception instanceof Error ? exception.stack : String(exception),
    );
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      status: 'error',
      error:  'INTERNAL_ERROR',
    });
  }
}
