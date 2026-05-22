import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

// PR-WIX-1 — Wix webhook shared-secret guard.
//
// Wix has no static IP we can allow-list, so we authenticate every
// inbound webhook by a shared secret in the `x-sorena-webhook-secret`
// header. The secret lives in the WIX_WEBHOOK_SECRET env var; if
// the var isn't set the guard rejects everything (fail-closed —
// better than accidentally exposing the endpoint).
//
// Comparison uses `timingSafeEqual` so a timing oracle can't be
// used to extract the secret one byte at a time. Buffer-length
// mismatch returns 401 directly without ever calling the comparator.

const HEADER = 'x-sorena-webhook-secret';

@Injectable()
export class WixSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const expected = this.config.get<string>('WIX_WEBHOOK_SECRET');
    const provided = req.headers?.[HEADER];

    if (!expected || typeof expected !== 'string' || expected.length === 0) {
      // Misconfiguration — refuse rather than fall open.
      throw new HttpException(
        { status: 'error', error: 'INVALID_SECRET' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (typeof provided !== 'string' || provided.length === 0) {
      throw new HttpException(
        { status: 'error', error: 'INVALID_SECRET' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new HttpException(
        { status: 'error', error: 'INVALID_SECRET' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return true;
  }
}
