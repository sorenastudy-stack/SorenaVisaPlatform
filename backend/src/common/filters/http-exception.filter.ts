import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // Some paths (e.g. an OAuth guard that already issued a 302 redirect)
    // have written the response before an exception propagates here.
    // Writing again throws ERR_HTTP_HEADERS_SENT, which is uncaught and
    // crashes the whole process. Bail out — the client already has a
    // response.
    if (response.headersSent) {
      this.logger.warn(
        'Exception after response already sent; skipping filter write.',
      );
      return;
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An unexpected error occurred. Please try again.';
    // Extra fields a 4xx may carry to the client — see the opt-in below.
    let extra: Record<string, unknown> | null = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'message' in exceptionResponse
      ) {
        const msg = (exceptionResponse as any).message;
        message = Array.isArray(msg) ? msg[0] : String(msg);

        // OPT-IN structured 4xx. The uniform {statusCode, message, timestamp}
        // shape is the default precisely so internals cannot leak out of an
        // error path, and every existing endpoint keeps it unchanged.
        //
        // Some refusals are only actionable WITH detail: the programme
        // deactivation guard answers 409 with the students already holding
        // that programme, so the Owner can be shown exactly who is affected
        // and confirm. Flattening that to a sentence makes the UI unable to
        // offer the confirmation at all.
        //
        // The opt-in is a `details` object, and ONLY that object is copied.
        // It is deliberately not `error`: Nest sets `error: 'Bad Request'` on
        // its own built-in exceptions, so keying on that would silently widen
        // the response of almost every endpoint in the API.
        const body = exceptionResponse as Record<string, unknown>;
        if (
          status < 500 &&
          typeof body.details === 'object' &&
          body.details !== null &&
          !Array.isArray(body.details)
        ) {
          extra = { details: body.details };
        }
      }
      // Log 5xx HttpExceptions too — a controller can throw a
      // generic InternalServerErrorException and silence the real
      // cause without this. 4xx is intentional client-error and
      // already structured, so we skip those.
      if (status >= 500) {
        this.logger.error(
          `HttpException (${status})`,
          exception.stack,
        );
      }
    } else {
      this.logger.error(
        'Unhandled exception',
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      ...(extra ?? {}),
    });
  }
}
