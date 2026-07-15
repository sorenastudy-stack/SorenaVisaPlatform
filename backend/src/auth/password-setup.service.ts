import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

/**
 * Client-onboarding "create your password" service. Cloned from
 * MagicLinkService, with one hard rule that makes it FIRST-TIME ONLY,
 * never a reset:
 *
 *   The token is issued ONLY for brand-new passwordless LEADs (from the
 *   public scorecard), and `setPassword` re-checks `passwordHash === null`
 *   AND `role === 'LEAD'` IMMEDIATELY BEFORE writing. So a leaked or replayed
 *   token can never overwrite an account that already has a password, and can
 *   never touch a staff account.
 *
 * Invariants (mirroring MagicLinkService):
 *   - Raw token is never stored — only sha256(raw).
 *   - Single-use: consumedAt is set via a race-safe updateMany guard BEFORE
 *     the password is written (fail closed).
 *   - 24h TTL (longer than magic-link's 15m — this is a first-touch email).
 *   - validateToken is READ-ONLY (scanner-safe): the consume happens on the
 *     password POST, not on the GET.
 *   - On success mints the SAME JWT shape as password/Google/magic-link login.
 */

const TOKEN_BYTES  = 32;                    // 256-bit random secret
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;   // 24 hours
const BCRYPT_ROUNDS = 10;                   // matches AuthService.register
const RESEND_COOLDOWN_MS = 60 * 1000;       // per-email min gap between resends

@Injectable()
export class PasswordSetupService {
  private readonly logger = new Logger(PasswordSetupService.name);

  constructor(
    private readonly prisma:      PrismaService,
    private readonly jwtService:  JwtService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Issue a first-time set-password link. Called ONLY from the scorecard
   * new-account branch. Defensive: looks the user up and issues ONLY when
   * they are a passwordless LEAD (silently no-ops otherwise, so a misuse
   * can never mint a reset link for an account with a password / a staff
   * account). Never throws into the caller's business action.
   */
  async requestSetup(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, email: true, role: true, passwordHash: true, isActive: true },
    });

    if (!user || !user.isActive) {
      this.logger.warn(`password-setup request — user ${userId} missing/inactive; no link issued`);
      return;
    }
    // FIRST-TIME ONLY: never issue for an account that already has a password
    // or that isn't a LEAD.
    if (user.role !== 'LEAD' || user.passwordHash !== null) {
      this.logger.warn(
        `password-setup request — user ${userId} is not a passwordless LEAD (role=${user.role}, hasPassword=${user.passwordHash !== null}); no link issued`,
      );
      return;
    }

    await this.issueAndSend(user.id, user.email);
    this.logger.log(`password-setup link issued for user ${user.id} (${user.email})`);
  }

  /**
   * Resend the set-password link — the "send it again" action on the scorecard
   * completion screen. ANTI-ENUMERATION: never throws and never reveals account
   * state; the caller (controller) returns a generic success regardless.
   * Sends ONLY when the address is an active, passwordless LEAD that still has
   * a PENDING (unconsumed) onboarding token — i.e. someone genuinely mid-
   * onboarding. A fresh token invalidates the previous one (only the newest
   * link works), and a per-email cooldown blocks inbox spam. This can't be used
   * to mail arbitrary inboxes or to probe for accounts.
   */
  async resendSetup(email: string): Promise<void> {
    const normalized = String(email ?? '').trim().toLowerCase();
    if (!normalized) return;

    const user = await this.prisma.user.findFirst({
      where:  { email: { equals: normalized, mode: 'insensitive' } },
      select: { id: true, email: true, role: true, passwordHash: true, isActive: true },
    });
    // Eligible only: active, passwordless LEAD. Silent otherwise.
    if (!user || !user.isActive || user.role !== 'LEAD' || user.passwordHash !== null) {
      this.logger.warn(`password-setup resend — no eligible account for "${normalized}" (silent generic success)`);
      return;
    }

    // Only for someone genuinely mid-onboarding: a PENDING (unconsumed) token
    // must exist. If they never had one, or already used/consumed it, do nothing
    // — this stops the endpoint from mailing an arbitrary LEAD on demand.
    const latest = await this.prisma.passwordSetupToken.findFirst({
      where:   { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select:  { consumedAt: true, createdAt: true },
    });
    if (!latest || latest.consumedAt !== null) {
      this.logger.warn(`password-setup resend — no pending token for user ${user.id} (silent)`);
      return;
    }

    // Per-email cooldown — refuse rapid re-sends (inbox-spam guard), on top of
    // the controller's per-IP @Throttle.
    if (Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      this.logger.warn(`password-setup resend — cooldown active for user ${user.id} (silent)`);
      return;
    }

    await this.issueAndSend(user.id, user.email);
    this.logger.log(`password-setup resent for user ${user.id} (${user.email})`);
  }

  /**
   * Invalidate any prior unconsumed tokens for the user (so only the newest
   * link works), mint a fresh single-use token, and email the link. Shared by
   * requestSetup + resendSetup.
   */
  private async issueAndSend(userId: string, email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    // Invalidate outstanding links — only the freshly-minted one will validate.
    await this.prisma.passwordSetupToken.updateMany({
      where: { userId, consumedAt: null },
      data:  { consumedAt: new Date() },
    });
    const rawToken  = randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
    await this.prisma.passwordSetupToken.create({
      data: { userId, email: normalized, tokenHash, expiresAt },
    });
    const url = this.buildSetupUrl(rawToken, normalized);
    await this.mailService.sendPasswordSetup(email, url);
  }

  /**
   * READ-ONLY validation for the /set-password page load. Checks the token
   * exists, matches the email, is unconsumed + unexpired, and belongs to an
   * active passwordless LEAD — WITHOUT consuming it. Scanner-safe: a prefetch
   * GET can't burn the token (and can't set a password anyway). Throws the
   * same generic UnauthorizedException on any failure.
   */
  async validateToken(rawToken: string, email: string): Promise<void> {
    await this.resolveUsableToken(rawToken, email);
  }

  /**
   * Consume the token and set the user's FIRST password. Throws a single
   * generic UnauthorizedException on any failure path. Reached only by the
   * user-confirmed POST (the password is in the body).
   */
  async setPassword(
    rawToken: string,
    email:    string,
    password: string,
  ): Promise<{ token: string; role: string }> {
    const { row } = await this.resolveUsableToken(rawToken, email);

    // Single-use: consume BEFORE writing the password. updateMany with the
    // unconsumed guard is race-safe — two concurrent submits can only win once.
    const consumed = await this.prisma.passwordSetupToken.updateMany({
      where: { id: row.id, consumedAt: null },
      data:  { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      this.logger.warn(`password-setup — token consumed by a concurrent request (row ${row.id})`);
      throw new UnauthorizedException('Invalid or expired link');
    }

    // THE HIJACK GUARD — re-assert, right before the write, that the account
    // is STILL a passwordless LEAD. If a password was set in the meantime (or
    // this is somehow a non-LEAD), refuse: the token can never overwrite an
    // existing password nor touch a staff account.
    const user = await this.prisma.user.findUnique({
      where:  { id: row.userId },
      select: { id: true, email: true, role: true, secondaryRoles: true, passwordHash: true, isActive: true },
    });
    if (!user || !user.isActive || user.role !== 'LEAD' || user.passwordHash !== null) {
      this.logger.warn(
        `password-setup — refused after consume for user ${row.userId} (role=${user?.role}, hasPassword=${user?.passwordHash !== null})`,
      );
      throw new UnauthorizedException('Invalid or expired link');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data:  { passwordHash, lastLoginAt: new Date() },
    });

    const token = this.jwtService.sign({
      sub:   user.id,
      email: user.email,
      role:  user.role,
      secondaryRoles: user.secondaryRoles,
    });
    this.logger.log(`password-setup OK — first password set for user ${user.id} (${user.email})`);
    return { token, role: user.role };
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  /**
   * Shared token resolution used by both validate + setPassword. Applies ALL
   * checks (existence, email match, unconsumed, unexpired, active passwordless
   * LEAD) WITHOUT consuming. Returns the row + user on success; throws the
   * generic UnauthorizedException otherwise.
   */
  private async resolveUsableToken(
    rawToken: string,
    email:    string,
  ): Promise<{ row: { id: string; userId: string } }> {
    if (!rawToken || !email) {
      throw new UnauthorizedException('Invalid or expired link');
    }
    const normalized = String(email).trim().toLowerCase();
    const tokenHash  = createHash('sha256').update(String(rawToken)).digest('hex');

    const row = await this.prisma.passwordSetupToken.findFirst({
      where:  { tokenHash },
      select: { id: true, userId: true, email: true, expiresAt: true, consumedAt: true },
    });
    if (!row) throw new UnauthorizedException('Invalid or expired link');
    if (row.email !== normalized) throw new UnauthorizedException('Invalid or expired link');
    if (row.consumedAt !== null) throw new UnauthorizedException('Invalid or expired link');
    if (row.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('Invalid or expired link');

    const user = await this.prisma.user.findUnique({
      where:  { id: row.userId },
      select: { isActive: true, role: true, passwordHash: true },
    });
    // Only an active, still-passwordless LEAD may use the token.
    if (!user || !user.isActive || user.role !== 'LEAD' || user.passwordHash !== null) {
      throw new UnauthorizedException('Invalid or expired link');
    }

    return { row: { id: row.id, userId: row.userId } };
  }

  /**
   * FRONTEND set-password page URL. The raw token + email ride in the URL
   * fragment (never sent to the server / access logs), matching the magic-link
   * confirm-page convention. FRONTEND_URL default mirrors MailService.
   */
  private buildSetupUrl(rawToken: string, email: string): string {
    const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    const params = new URLSearchParams({ token: rawToken, email });
    return `${base}/set-password#${params.toString()}`;
  }
}
