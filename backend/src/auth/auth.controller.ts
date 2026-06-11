import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { GoogleAuthGuard } from './google-auth.guard';
import type { ValidatedGoogleUser } from './google.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService:  JwtService,
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

  private frontendUrl(suffix: string): string {
    const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    if (!base) return suffix;
    return `${base}${suffix.startsWith('/') ? '' : '/'}${suffix}`;
  }
}
