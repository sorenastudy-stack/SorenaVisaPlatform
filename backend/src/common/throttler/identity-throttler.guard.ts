import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
  getOptionsToken,
  getStorageToken,
} from '@nestjs/throttler';

// PR-RATE-LIMIT-IDENTITY — rate-limit buckets keyed by WHO is asking, not by
// which address the packet arrived from.
//
// THE BUG. Pages under /portal are React Server Components: the Next.js service
// calls this API on the client's behalf, from its own container. Express sees
// the frontend's address for every one of those calls, and the stock throttler
// keys purely on `req.ip`, so ALL server-rendered traffic — every client, every
// page — shared a single 60-requests-per-minute bucket. The portal shell alone
// spends about four requests per render, so a few dozen concurrent clients were
// enough for one person's browsing to start returning 429 to everybody else.
// That is a denial-of-service any single client could trigger by accident.
//
// This is not fixed by `trust proxy` (already set, and correct for direct
// browser calls): the frontend really is the origin of those requests. The
// address is not being lost in a header — there is no client address to find,
// because the client never opened that connection.
//
// THE FIX, and why it is this one. `apiServer` already forwards the caller's
// session as a Bearer token, so the request carries a verifiable identity even
// though it carries a borrowed IP. Keying on the token's subject gives every
// client their own bucket regardless of which container made the call.
//
// The alternative — have Next.js forward the client IP in a header — was
// rejected. It would mean trusting a client-settable header on an auth-adjacent
// path: anyone could then send `X-Forwarded-For: <random>` on each request and
// mint themselves an unlimited number of fresh buckets, turning a rate limiter
// into decoration. Guarding it with a shared secret would work but adds a
// spoofable-by-config trust relationship for no benefit over the token that is
// already there and already verified.
//
// SECURITY PROPERTIES — this must not loosen anything:
//   • The token is VERIFIED, not decoded. An unsigned or tampered token fails
//     verification and falls back to the IP bucket, so a forged `sub` cannot be
//     used to escape a limit. Verifying is the whole point: `jwt.decode()` here
//     would let an attacker rotate the subject and never be limited at all.
//   • Anonymous requests are unchanged — still `ip:<address>`. Login, password
//     reset and the other pre-auth routes, where brute-force protection actually
//     matters, keep exactly the limits and the keying they had.
//   • It is stricter in one direction: an authenticated caller spreading a flood
//     across many source addresses used to get a fresh bucket per address, and
//     is now held to one bucket per account.
//   • Per-route `@Throttle` overrides and `@SkipThrottle` are untouched; this
//     changes the KEY, never the limit.
@Injectable()
export class IdentityThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = this.verifiedUserId(req);
    // The prefixes matter: without them a user whose id happened to look like
    // an address would share a bucket with that address.
    return userId ? `user:${userId}` : `ip:${req?.ip ?? 'unknown'}`;
  }

  /** The `sub` of a cryptographically valid session token, or null. */
  private verifiedUserId(req: Record<string, any>): string | null {
    const header = req?.headers?.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    try {
      // Signature AND expiry are checked. An expired session falls back to the
      // IP bucket rather than keeping its own.
      const payload = this.jwt.verify<{ sub?: unknown }>(header.slice(7).trim());
      return typeof payload?.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
