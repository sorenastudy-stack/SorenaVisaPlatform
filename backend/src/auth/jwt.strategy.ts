import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
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

  validate(payload: any) {
    return { userId: payload.sub, email: payload.email, role: payload.role };
  }
}
