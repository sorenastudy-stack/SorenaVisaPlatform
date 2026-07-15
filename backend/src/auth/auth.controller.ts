import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { GoogleAuthGuard } from './google-auth.guard';
import type { ValidatedGoogleUser } from './google.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { MagicLinkService } from './magic-link.service';
import { PasswordSetupService } from './password-setup.service';
import { SetPasswordDto } from './dto/set-password.dto';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService:          AuthService,
    private readonly jwtService:           JwtService,
    private readonly magicLinkService:     MagicLinkService,
    private readonly passwordSetupService: PasswordSetupService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'SUPER_ADMIN')
  @Post('register')
  async register(
    @Body('email') email: string,
    @Body('name') name: string,
    @Body('password') password: string,
    @Body('role') role?: string,
  ) {
    return this.authService.register(email, name, password, role);
  }

  @Post('login')
  async login(
    @Body('email') email: string,
    @Body('password') password: string,
  ) {
    return this.authService.login(email, password);
  }

  // PR-OPTION-C step 2 — Google OAuth entry. The guard intercepts and
  // 302s the browser to Google's consent screen. The body never runs.
  // Skip throttling — a user clicking "Continue with Google" twice
  // (browser nav back/forward, retry after consent) shouldn't 429
  // mid-flow. The OAuth round-trip itself rate-limits at Google's end.
  @SkipThrottle()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleStart(): void {
    /* intentionally empty — guard performs the redirect */
  }

  // PR-OPTION-C step 2 — Google OAuth callback. On success, the guard
  // calls GoogleStrategy.validate(), which attaches the validated User
  // row to req.user. We mint the SAME JWT the password login issues
  // (sub, email, role; 24h via JwtModule.register) and redirect to the
  // frontend's /auth/callback page with the token in the URL fragment
  // — fragments don't reach server access logs.
  //
  // Failure cases (unknown email, inactive, mismatch) are handled by
  // GoogleAuthGuard.canActivate → 302 to /login?error=not_authorized.
  // This handler only runs on success.
  // Skip throttling — same reasoning as /auth/google: the callback
  // arrives once per consent and a 429 mid-redirect would strand
  // the user.
  @SkipThrottle()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  googleCallback(@Req() req: Request, @Res() res: Response): void {
    const user = req.user as ValidatedGoogleUser | undefined;
    if (!user) {
      const target = this.frontendUrl('/login?error=not_authorized');
      res.redirect(302, target);
      return;
    }

    const token = this.jwtService.sign({
      sub:   user.id,
      email: user.email,
      role:  user.role,
    });

    const params = new URLSearchParams({ token, role: user.role });
    const target = this.frontendUrl(`/auth/callback#${params.toString()}`);
    res.redirect(302, target);
  }

  // PR-OPTION-C step 3 — magic-link sign-in: request a link.
  //
  // ANTI-ENUMERATION: this endpoint ALWAYS returns 200 with the same
  // generic body regardless of whether the email is registered,
  // inactive, or anything in between. The service layer handles the
  // case split silently; this controller catches any unexpected
  // throw, logs server-side, and still returns the generic 200 so
  // an attacker can't probe the user table by watching status codes
  // or response timing variance.
  //
  // RATE LIMIT: 5 requests per 60 seconds per IP via @Throttle —
  // mirrors the existing pattern on /acquisition/leads. This is on
  // TOP of the global 60/min ThrottlerModule default.
  @Post('magic-link/request')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async magicLinkRequest(
    @Body('email') email: string,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      await this.magicLinkService.requestLink(email);
    } catch (err) {
      this.logger.error(
        `magic-link request unexpectedly threw — returning generic 200 anyway: ${
          (err as Error)?.message ?? err
        }`,
      );
    }
    return {
      ok: true,
      message: 'If that email is registered, a login link has been sent.',
    };
  }

  // PR-OPTION-C step 3 — magic-link sign-in: verify + mint JWT.
  //
  // On success: 302 to the frontend's /auth/callback page with the
  // token + role in the URL fragment — same contract the Google
  // callback uses, so /auth/callback handles both transparently.
  // On any failure (bad/expired/used token, email mismatch, missing
  // or inactive user): 302 to /login?error=invalid_link. The browser
  // never sees a raw 4xx/5xx body, just a redirect.
  // Skip throttling — same reasoning as /auth/google/callback: this
  // is the email-click round-trip that completes login. A 429 here
  // strands a legitimate user. Replay is already prevented by the
  // one-time-consume token guard in MagicLinkService.verifyAndIssue.
  @SkipThrottle()
  @Get('magic-link/verify')
  async magicLinkVerify(
    @Query('token') rawToken: string,
    @Query('email') email:    string,
    @Res()         res:       Response,
  ): Promise<void> {
    try {
      // TWO-STEP: validate the token WITHOUT consuming it, then hand off to a
      // user-confirmed POST. Email scanners/prefetchers issue GETs (this
      // route) but not the confirming POST, so they can no longer burn the
      // single-use token. On success the raw token + email ride in the URL
      // fragment (never sent to the server / access logs) to the confirm page.
      await this.magicLinkService.validateToken(rawToken, email);
      const params = new URLSearchParams({ token: rawToken, email });
      res.redirect(302, this.frontendUrl(`/auth/magic-link/confirm#${params.toString()}`));
    } catch (err) {
      this.logger.warn(
        `magic-link verify (validate) failed → /client/login?error=invalid_link: ${
          (err as Error)?.message ?? err
        }`,
      );
      // Magic-link is the CLIENT sign-in path (staff use password/Google), so
      // failures go to the client login, never the staff /login.
      res.redirect(302, this.frontendUrl('/client/login?error=invalid_link'));
    }
  }

  // PR-OPTION-C — magic-link CONFIRM: the explicit user action that consumes
  // the token + mints the JWT. Returns JSON to the same-origin Next route,
  // which sets the sorena_session cookie. Skip-throttle mirrors the verify
  // step; replay is prevented by the single-use consume in verifyAndIssue.
  @SkipThrottle()
  @Post('magic-link/confirm')
  async magicLinkConfirm(
    @Body('token') rawToken: string,
    @Body('email') email:    string,
  ): Promise<{ token: string; role: string }> {
    return this.magicLinkService.verifyAndIssue(rawToken, email);
  }

  // Client-onboarding: FIRST-TIME "create your password" flow.
  //
  // TWO steps mirror the magic-link two-step so it's scanner-safe:
  //   GET  /auth/set-password/validate — READ-ONLY, consumes nothing. The
  //        /set-password page calls it to decide "show form" vs "link expired".
  //   POST /auth/set-password          — consumes the token + sets the FIRST
  //        password (never a reset — the service refuses if a password already
  //        exists or the account isn't a LEAD) and returns the JWT for the
  //        same-origin Next route to set sorena_session.
  //
  // Both throttled: probing a 256-bit token is infeasible, but rate-limit is
  // defence-in-depth on top of the global default.
  @Get('set-password/validate')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async setPasswordValidate(
    @Query('token') rawToken: string,
    @Query('email') email:    string,
  ): Promise<{ valid: true }> {
    await this.passwordSetupService.validateToken(rawToken, email);
    return { valid: true };
  }

  @Post('set-password')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async setPassword(
    @Body() dto: SetPasswordDto,
  ): Promise<{ token: string; role: string }> {
    return this.passwordSetupService.setPassword(dto.token, dto.email, dto.password);
  }

  // Resend the onboarding "create your password" link (the completion screen's
  // "send it again"). ANTI-ENUMERATION: always 200 with a generic body,
  // whatever the account state — the service silently no-ops unless the address
  // is a passwordless LEAD with a pending token (and a fresh token invalidates
  // the old one). Hard per-IP throttle (3/min) on top of the service's
  // per-email cooldown, so it can't spam an inbox or probe for accounts.
  @Post('set-password/resend')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async setPasswordResend(
    @Body('email') email: string,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      await this.passwordSetupService.resendSetup(email);
    } catch (err) {
      this.logger.error(
        `set-password resend unexpectedly threw — returning generic 200 anyway: ${
          (err as Error)?.message ?? err
        }`,
      );
    }
    return { ok: true, message: 'If your assessment is awaiting setup, a fresh link has been sent.' };
  }

  private frontendUrl(suffix: string): string {
    const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    if (!base) return suffix;
    return `${base}${suffix.startsWith('/') ? '' : '/'}${suffix}`;
  }
}
