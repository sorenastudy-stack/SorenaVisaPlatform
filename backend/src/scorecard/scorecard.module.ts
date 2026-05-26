import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { ScorecardService } from './scorecard.service';
import { ScorecardController } from './scorecard.controller';

// PR-SCORECARD-1 — Readiness Assessment scoring engine + lead pipeline.
//
// The TypeScript scoring engine port lives under ./scoring and is
// pure (no Nest dependencies) so the unit tests can import it
// directly without bootstrapping the Nest app.

@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [ScorecardController],
  providers: [ScorecardService],
  exports: [ScorecardService],
})
export class ScorecardModule {}
