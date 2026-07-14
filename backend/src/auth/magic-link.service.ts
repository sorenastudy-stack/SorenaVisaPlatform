import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

/**
 * PR-OPTION-C step 3 — magic-link sign-in service.
 *
 * Two methods:
 *   - requestLink(email): silent on unknown/inactive (anti-enumeration);
 *     on a valid match, mints a one-time token, stores its SHA-256 hash
 *     in magic_link_tokens (with userId FK + lowercased email), and
 *     emails the user a 15-minute single-use sign-in link via the
 *     existing MailService.
 *   - verifyAndIssue(rawToken, email): matches the row by tokenHash,
 *     validates email + expiry + unused, marks consumedAt (one-time),
 *     looks the user up authoritatively by userId (the FK — survives
 *     a later email change), checks isActive, stamps lastLoginAt, and
 *     returns the SAME JWT shape the Google + password flows issue.
 *
 * Invariants:
 *   - The raw token is NEVER stored — only sha256(raw) is.
 *   - Token TTL is 15 minutes from row insert.
 *   - consumedAt is set BEFORE the JWT is minted, so a crash between
 *     the two leaves the token used (fail closed).
 *   - JWT payload + signing match the existing GoogleStrategy →
 *     AuthController.googleCallback() flow exactly so the frontend's
 *     /auth/callback page handles both transparently.
 */

const TOKEN_BYTES        = 32;                  // 256-bit random secret
const TOKEN_TTL_MS       = 15 * 60 * 1000;      // 15 minutes
const FALLBACK_BACKEND   = 'https://api.sorenavisa.com';

@Injectable()
export class MagicLinkService {
  private readonly logger = new Logger(MagicLinkService.name);

  constructor(
    private readonly prisma:      PrismaService,
    private readonly jwtService:  JwtService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Request a sign-in link. Generic success even if the email isn't
   * registered — no enumeration. Caller (controller) returns the
   * generic JSON whatever this method does.
   */
  async requestLink(email: string): Promise<void> {
    const normalized = String(email ?? '').trim().toLowerCase();
    if (!normalized) {
      // Empty input — silently return. Controller still 200s.
      return;
    }

    const user = await this.prisma.user.findFirst({
      where: { email: { equals: normalized, mode: 'insensitive' } },
      select: { id: true, email: true, name: true, isActive: true },
    });

    if (!user || !user.isActive) {
      this.logger.warn(
        `magic-link request — no match or inactive for "${normalized}" (silent generic success)`,
      );
      return;
    }

    // 256-bit random secret. Hex-encoded for URL safety.
    const rawToken  = randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await this.prisma.magicLinkToken.create({
      data: {
        userId:    user.id,
        email:     normalized,
        tokenHash,
        expiresAt,
      },
    });

    const verifyUrl = this.buildVerifyUrl(rawToken, normalized);
    await this.mailService.sendMagicLinkLogin(user.email, user.name, verifyUrl);

    this.logger.log(
      `magic-link issued for user ${user.id} (${user.email}); expires ${expiresAt.toISOString()}`,
    );
  }

  /**
   * READ-ONLY validation for the two-step verify. Checks the token exists,
   * matches the email, is not yet consumed, is unexpired, and belongs to an
   * active user — WITHOUT consuming it. The GET /auth/magic-link/verify
   * landing calls this so an email scanner's prefetch GET can't burn the
   * single-use token; the actual consume happens later on the user's POST.
   * Throws the same generic UnauthorizedException on any failure.
   */
  async validateToken(rawToken: string, email: string): Promise<void> {
    if (!rawToken || !email) {
      throw new UnauthorizedException('Invalid or expired link');
    }
    const normalized = String(email).trim().toLowerCase();
    const tokenHash = createHash('sha256').update(String(rawToken)).digest('hex');

    const row = await this.prisma.magicLinkToken.findFirst({
      where: { tokenHash },
      select: { id: true, userId: true, email: true, expiresAt: true, consumedAt: true },
    });
    if (!row) throw new UnauthorizedException('Invalid or expired link');
    if (row.email !== normalized) throw new UnauthorizedException('Invalid or expired link');
    if (row.consumedAt !== null) throw new UnauthorizedException('Invalid or expired link');
    if (row.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('Invalid or expired link');

    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { isActive: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid or expired link');
  }

  /**
   * Consume a magic-link token and mint the existing JWT. Throws
   * UnauthorizedException with a single generic message on any failure
   * path. Reached only by the user-confirmed POST (email scanners GET, they
   * don't POST) so the single-use token survives prefetch/scanning.
   */
  async verifyAndIssue(
    rawToken: string,
    email:    string,
  ): Promise<{ token: string; role: string }> {
    if (!rawToken || !email) {
      throw new UnauthorizedException('Invalid or expired link');
    }
    const normalized = String(email).trim().toLowerCase();
    const tokenHash  = createHash('sha256').update(String(rawToken)).digest('hex');

    const row = await this.prisma.magicLinkToken.findFirst({
      where: { tokenHash },
      select: {
        id:         true,
        userId:     true,
        email:      true,
        expiresAt:  true,
        consumedAt: true,
      },
    });

    if (!row) {
      this.logger.warn('magic-link verify — token not found');
      throw new UnauthorizedException('Invalid or expired link');
    }
    if (row.email !== normalized) {
      this.logger.warn(
        `magic-link verify — email mismatch on row ${row.id} (token belongs to a different address)`,
      );
      throw new UnauthorizedException('Invalid or expired link');
    }
    if (row.consumedAt !== null) {
      this.logger.warn(`magic-link verify — token already consumed (row ${row.id})`);
      throw new UnauthorizedException('Invalid or expired link');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      this.logger.warn(`magic-link verify — token expired (row ${row.id})`);
      throw new UnauthorizedException('Invalid or expired link');
    }

    // Mark consumed BEFORE issuing the JWT — fail closed if anything
    // after this point throws. updateMany with the unconsumed guard
    // is the race-safe form: two concurrent verifies of the same
    // token can only succeed once.
    const consumed = await this.prisma.magicLinkToken.updateMany({
      where: { id: row.id, consumedAt: null },
      data:  { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      this.logger.warn(
        `magic-link verify — token consumed by a concurrent request (row ${row.id})`,
      );
      throw new UnauthorizedException('Invalid or expired link');
    }

    // Authoritative user lookup by FK — survives a later email change.
    const user = await this.prisma.user.findUnique({
      where:  { id: row.userId },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) {
      this.logger.warn(
        `magic-link verify — user ${row.userId} missing or inactive after token consume`,
      );
      throw new UnauthorizedException('Invalid or expired link');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data:  { lastLoginAt: new Date() },
    });

    const token = this.jwtService.sign({
      sub:   user.id,
      email: user.email,
      role:  user.role,
    });
    this.logger.log(`magic-link login OK for user ${user.id} (${user.email})`);
    return { token, role: user.role };
  }

  // ─── Internals ─────────────────────────────────────────────────────

  /**
   * BACKEND public URL builder. Reads BACKEND_URL from env; falls back
   * to the known production URL so a missing env var doesn't break
   * the email rendering. Trailing slashes normalised away.
   */
  private buildVerifyUrl(rawToken: string, email: string): string {
    const base = (process.env.BACKEND_URL || FALLBACK_BACKEND).replace(/\/$/, '');
    const params = new URLSearchParams({ token: rawToken, email });
    return `${base}/auth/magic-link/verify?${params.toString()}`;
  }
}
