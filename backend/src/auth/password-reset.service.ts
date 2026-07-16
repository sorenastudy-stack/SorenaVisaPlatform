import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

/**
 * Phase F — staff (and any role) self-service password RESET.
 *
 * Cloned from the PasswordSetupService PATTERN — sha256-hashed tokens, race-safe
 * single-use `consumedAt` guard, short TTL, read-only two-step (scanner-safe)
 * validate/consume, mints the SAME JWT as password/Google/magic-link login — but
 * unlike setup it works for ANY active account and OVERWRITES the password.
 * Purpose-scoped `PasswordResetToken` table keeps it fully isolated from the
 * LEAD-only setup token (a setup token can never reach here, and vice-versa).
 *
 * Anti-enumeration: `requestReset` is silent on unknown/inactive accounts — the
 * controller always returns a generic 200. Audit rows are written for the two
 * real events (requested + completed) with actor + IP.
 */

const TOKEN_BYTES        = 32;                 // 256-bit random secret
const TOKEN_TTL_MS       = 30 * 60 * 1000;     // 30 minutes — short, per spec
const BCRYPT_ROUNDS      = 10;                 // matches AuthService / setup
const RESEND_COOLDOWN_MS = 60 * 1000;          // per-user min gap between sends

interface RequestMeta { ipAddress?: string | null; }

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Issue a reset link for an existing, active account. Silent (no throw, no
   * signal) on unknown/inactive email — anti-enumeration. A 60s per-user
   * cooldown prevents inbox flooding / probing.
   */
  async requestReset(email: string, meta: RequestMeta = {}): Promise<void> {
    const normalized = String(email ?? '').trim().toLowerCase();
    if (!normalized) return;

    const user = await this.prisma.user.findFirst({
      where: { email: { equals: normalized, mode: 'insensitive' } },
      select: { id: true, email: true, name: true, isActive: true, role: true },
    });
    if (!user || !user.isActive) {
      this.logger.warn(`password-reset request — no match/inactive for "${normalized}" (silent generic success)`);
      return;
    }

    // Cooldown: skip a resend if a fresh unconsumed token already exists.
    const latest = await this.prisma.passwordResetToken.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { consumedAt: true, createdAt: true },
    });
    if (latest && latest.consumedAt === null && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      this.logger.log(`password-reset request — within cooldown for user ${user.id}, not resending`);
      return;
    }

    await this.issueAndSend(user.id, user.email, user.name);
    await this.audit(user.id, 'PASSWORD_RESET_REQUESTED', user.role, user.name, meta.ipAddress ?? null);
  }

  /** READ-ONLY validation for the /reset-password page load (consumes nothing). */
  async validateToken(rawToken: string, email: string): Promise<void> {
    await this.resolveUsableToken(rawToken, email);
  }

  /**
   * Consume the single-use token and set the NEW password (overwrite). Mints the
   * standard JWT so the reset also signs the user in. Generic error on any
   * failure. Audits the completion with actor + IP.
   */
  async resetPassword(
    rawToken: string,
    email: string,
    password: string,
    meta: RequestMeta = {},
  ): Promise<{ token: string; role: string }> {
    const { row } = await this.resolveUsableToken(rawToken, email);

    // Single-use: consume BEFORE writing — race-safe unconsumed guard.
    const consumed = await this.prisma.passwordResetToken.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      this.logger.warn(`password-reset — token consumed by a concurrent request (row ${row.id})`);
      throw new UnauthorizedException('Invalid or expired link');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { id: true, email: true, name: true, role: true, secondaryRoles: true, isActive: true },
    });
    if (!user || !user.isActive) {
      this.logger.warn(`password-reset — refused after consume for user ${row.userId} (inactive/missing)`);
      throw new UnauthorizedException('Invalid or expired link');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    // Invalidate any other outstanding reset tokens for this user (defence).
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash, lastLoginAt: new Date() } }),
      this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } }),
    ]);

    await this.audit(user.id, 'PASSWORD_RESET_COMPLETED', user.role, user.name, meta.ipAddress ?? null);

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      secondaryRoles: user.secondaryRoles,
    });
    this.logger.log(`password-reset OK — password reset for user ${user.id} (${user.email})`);
    return { token, role: user.role };
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private async issueAndSend(userId: string, email: string, name: string | null): Promise<void> {
    const normalized = email.trim().toLowerCase();
    await this.prisma.passwordResetToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    const rawToken = randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
    await this.prisma.passwordResetToken.create({
      data: { userId, email: normalized, tokenHash, expiresAt },
    });
    const frontend = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    // Token rides in the URL FRAGMENT (never sent to the server / access logs),
    // matching the set-password + magic-link-confirm pages. Scanner-safe: the
    // read-only validate + single-use consume both happen client-initiated.
    const url = `${frontend}/reset-password#token=${rawToken}&email=${encodeURIComponent(normalized)}`;
    await this.mailService.sendPasswordResetLink(email, name, url);
  }

  private async resolveUsableToken(
    rawToken: string,
    email: string,
  ): Promise<{ row: { id: string; userId: string } }> {
    if (!rawToken || !email) throw new UnauthorizedException('Invalid or expired link');
    const normalized = String(email).trim().toLowerCase();
    const tokenHash = createHash('sha256').update(String(rawToken)).digest('hex');

    const row = await this.prisma.passwordResetToken.findFirst({
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

    return { row: { id: row.id, userId: row.userId } };
  }

  private async audit(userId: string, eventType: string, role: string | null, name: string | null, ipAddress: string | null): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: eventType,
          eventType,
          entityType: 'User',
          entityId: userId,
          ipAddress,
          actorNameSnapshot: name,
          actorRoleSnapshot: role,
        },
      });
    } catch (e) {
      this.logger.error(`password-reset audit write failed (${eventType}, user ${userId}): ${(e as Error)?.message ?? e}`);
    }
  }
}
