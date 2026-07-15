import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { PrismaService } from '../prisma/prisma.service';
import { linkContactByEmail } from './contact-link.helper';

/**
 * PR-OPTION-C step 2 — Google OAuth strategy, invite-only.
 *
 * Issues:
 *   - GET /auth/google           → guard triggers redirect to Google consent.
 *   - GET /auth/google/callback  → guard runs this strategy's validate();
 *     the controller then mints the existing JWT and redirects to the
 *     frontend. The verify shape (done(null, user)) leaves req.user
 *     populated with our DB User row for the controller to read.
 *
 * Invite-only enforcement lives entirely in validate(): a Google
 * identity that doesn't match an existing User row is rejected with
 * UnauthorizedException. Unknown emails never create rows.
 *
 * Failure path: any rejection from validate() bubbles to the
 * GoogleAuthGuard's handleRequest, which the controller's failure
 * redirect converts into "?error=not_authorized" on the frontend.
 */

export interface ValidatedGoogleUser {
  id:    string;
  email: string;
  role:  string;
  secondaryRoles: string[];
  name:  string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(private readonly prisma: PrismaService) {
    super({
      clientID:     process.env.GOOGLE_CLIENT_ID     || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackURL:  process.env.GOOGLE_CALLBACK_URL  || '',
      scope:        ['email', 'profile'],
      // Disabling session is critical — we use stateless JWTs, not
      // passport's session middleware.
      passReqToCallback: false,
    });
  }

  /**
   * Invite-only verify. Called by passport after the OAuth code
   * exchange returns a profile. Pure function over (profile,
   * PrismaService); no req, no session, no side-effects beyond the
   * single User row update.
   */
  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    try {
      const user = await this.verifyGoogleProfile(profile);
      done(null, user);
    } catch (err) {
      done(err as Error, undefined);
    }
  }

  /**
   * Split out from validate() so the unit tests can drive it
   * directly without juggling passport's done() callback contract.
   * Returns the User row that the controller will pack into a JWT.
   */
  async verifyGoogleProfile(profile: Profile): Promise<ValidatedGoogleUser> {
    const googleId = profile?.id;
    if (!googleId) {
      throw new UnauthorizedException('Google profile is missing an id');
    }

    // Google returns emails[] with verified flags; we trust the
    // first verified entry. If none verified, reject — we won't
    // bind an unverified email to a User row.
    const emails = Array.isArray(profile?.emails) ? profile.emails : [];
    const verified = emails.find((e: any) => e?.verified !== false && e?.value);
    if (!verified) {
      throw new UnauthorizedException('Google profile has no verified email');
    }
    const email = String(verified.value).toLowerCase().trim();

    // Case-insensitive email lookup. The User.email column has a
    // unique constraint and existing rows were stored as the user
    // entered them; we lower-case + Prisma `mode: 'insensitive'`
    // to be robust against case variance.
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: {
        id:             true,
        email:          true,
        name:           true,
        role:           true,
        secondaryRoles: true,
        isActive:       true,
        googleId:       true,
      },
    });

    if (!user) {
      // Invite-only: no row, no row creation. Reject.
      this.logger.warn(`Google sign-in rejected — no invited user for email "${email}"`);
      throw new UnauthorizedException('Not authorized');
    }
    if (!user.isActive) {
      this.logger.warn(`Google sign-in rejected — user ${user.id} is inactive`);
      throw new UnauthorizedException('Not authorized');
    }

    if (user.googleId === null) {
      // First-time Google link. Bind the googleId and stamp lastLoginAt.
      await this.prisma.user.update({
        where: { id: user.id },
        data:  { googleId, lastLoginAt: new Date() },
      });
      this.logger.log(`Google linked to existing user ${user.id} (${user.email})`);
    } else if (user.googleId !== googleId) {
      // Existing googleId, different google account. Identity mismatch
      // — never replace silently, never log the conflicting id (it's
      // someone else's Google sub).
      this.logger.warn(`Google sign-in rejected — googleId mismatch for user ${user.id}`);
      throw new UnauthorizedException('Not authorized');
    } else {
      // Returning Google user. Bump lastLoginAt.
      await this.prisma.user.update({
        where: { id: user.id },
        data:  { lastLoginAt: new Date() },
      });
    }

    // Client portal step 1 — link any orphaned Contact with this
    // verified email to the resolved User. Idempotent; never
    // overwrites an already-linked Contact; preserves invite-only.
    // See contact-link.helper.ts for the full rationale.
    await linkContactByEmail(this.prisma, email, user.id);

    return {
      id:    user.id,
      email: user.email,
      role:  user.role,
      secondaryRoles: user.secondaryRoles,
      name:  user.name,
    };
  }
}
