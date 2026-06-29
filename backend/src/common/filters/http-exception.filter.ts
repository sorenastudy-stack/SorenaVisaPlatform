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
    });
  }
}
