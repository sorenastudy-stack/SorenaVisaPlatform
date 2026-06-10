import {
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';

/**
 * PR-OPTION-C step 2 — Google OAuth guard with redirect-on-failure.
 *
 * Wraps the stock AuthGuard('google'). On the callback route, if the
 * strategy rejects (unknown email / inactive / mismatch / any
 * passport error), we 302 the browser to FRONTEND_URL/login?error=
 * not_authorized rather than letting Nest return a JSON 401. This
 * keeps the OAuth round-trip ergonomic for end users.
 *
 * The initial /auth/google route never fails this way — that path
 * just builds the Google redirect URL and the user agent follows it.
 */

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  private readonly logger = new Logger(GoogleAuthGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const result = (await super.canActivate(context)) as boolean;
      return result;
    } catch (err) {
      this.logger.warn(
        `Google OAuth rejected: ${(err as Error)?.message ?? 'unknown'}`,
      );
      const res = context.switchToHttp().getResponse<Response>();
      const frontend = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
      // Empty FRONTEND_URL → use a relative path so the browser
      // resolves against the request origin.
      const target = frontend
        ? `${frontend}/login?error=not_authorized`
        : `/login?error=not_authorized`;
      res.redirect(302, target);
      // Returning false short-circuits Nest's pipeline without
      // throwing — Nest sees the response already sent and stops.
      return false;
    }
  }
}
