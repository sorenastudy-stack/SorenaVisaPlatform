import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { GoogleStrategy } from './google.strategy';
import { GoogleAuthGuard } from './google-auth.guard';
import { MagicLinkService } from './magic-link.service';
import { PrismaModule } from '../prisma/prisma.module';

// PR-AUDIT-2 — fail-fast at module-init if JWT_SECRET is missing.
// Mirrors the CryptoService / EmailHashService precedent ('<VAR> is
// not set'). The literal 'fallback_secret' default that used to be
// here meant a missing env var produced a guessable signing key —
// removed so a misconfigured deploy crashes loudly instead.
function requireJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: requireJwtSecret(),
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy, GoogleAuthGuard, MagicLinkService],
  exports: [AuthService, JwtModule, MagicLinkService],
})
export class AuthModule {}
