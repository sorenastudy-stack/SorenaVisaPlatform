import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

// PR-WEBINAR-1 — shared-secret guard for the sorenavisa.com website's
// server-to-server webinar registration call.
//
// The website's Next.js route calls this endpoint from its own server (not the
// visitor's browser), authenticated via a bearer token — mirrors
// `webhooks/wix/guards/wix-secret.guard.ts` (same fail-closed + timingSafeEqual
// approach) but reads `Authorization: Bearer <secret>`, which is what the
// website actually sends (verified in its route: it sets an Authorization
// header from SORENA_STUDY_WEBINAR_API_KEY when that variable is set).
//
// The secret lives in `WEBSITE_WEBINAR_API_KEY` on THIS backend and must hold
// the same value as `SORENA_STUDY_WEBINAR_API_KEY` on the website's Vercel
// project — two variable names for two apps, one shared value. If the variable
// is unset here the guard rejects everything (fail-closed).
//
// Note the asymmetry worth knowing about: the website only sends the header
// when ITS key is set. If the website's key is missing while ours is present,
// requests arrive unauthenticated and are correctly refused — the failure is
// visible as 401s here rather than as silently unauthenticated writes.

@Injectable()
export class WebinarApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const expected = this.config.get<string>('WEBSITE_WEBINAR_API_KEY');

    if (!expected || typeof expected !== 'string' || expected.length === 0) {
      throw new HttpException(
        { status: 'error', error: 'INVALID_API_KEY' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const authHeader = req.headers?.authorization;
    const provided = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : null;

    if (!provided) {
      throw new HttpException(
        { status: 'error', error: 'INVALID_API_KEY' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Compare on equal-length buffers: timingSafeEqual throws on a length
    // mismatch, and the length check must not short-circuit the comparison for
    // equal-length inputs.
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new HttpException(
        { status: 'error', error: 'INVALID_API_KEY' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return true;
  }
}
