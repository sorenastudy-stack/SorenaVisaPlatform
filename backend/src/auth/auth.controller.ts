import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { GoogleAuthGuard } from './google-auth.guard';
import type { ValidatedGoogleUser } from './google.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { MagicLinkService } from './magic-link.service';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService:      AuthService,
    private readonly jwtService:       JwtService,
    private readonly magicLinkService: MagicLinkService,
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
  @Get('magic-link/verify')
  async magicLinkVerify(
    @Query('token') rawToken: string,
    @Query('email') email:    string,
    @Res()         res:       Response,
  ): Promise<void> {
    try {
      const { token, role } = await this.magicLinkService.verifyAndIssue(rawToken, email);
      const params = new URLSearchParams({ token, role });
      res.redirect(302, this.frontendUrl(`/auth/callback#${params.toString()}`));
    } catch (err) {
      this.logger.warn(
        `magic-link verify failed (redirecting to /login?error=invalid_link): ${
          (err as Error)?.message ?? err
        }`,
      );
      res.redirect(302, this.frontendUrl('/login?error=invalid_link'));
    }
  }

  private frontendUrl(suffix: string): string {
    const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    if (!base) return suffix;
    return `${base}${suffix.startsWith('/') ? '' : '/'}${suffix}`;
  }
}
