import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    // PR-AUDIT-2 — fail-fast if JWT_SECRET is missing. Computed
    // BEFORE super() so the throw fires at Nest provider init,
    // not at first-request verification. Mirrors the
    // CryptoService '<VAR> is not set' pattern.
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  // PR-AUDIT-3 — verify the user still exists and is active on EVERY
  // request rather than trusting the 24h-old token payload. Previously
  // a deactivated user kept access until their JWT expired (up to 24h);
  // now revocation takes effect within milliseconds. role + email are
  // sourced from the DB so role changes also take effect on the next
  // request rather than at next token-issue time.
  //
  // Return shape MUST stay exactly { userId, role, email } — the rest
  // of the app reads req.user.userId at 129 sites and req.user.role at
  // 13 sites + RolesGuard. Renaming either breaks the world.
  async validate(payload: { sub: string; email: string; role: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is inactive or no longer exists');
    }
    return { userId: user.id, email: user.email, role: user.role };
  }
}
