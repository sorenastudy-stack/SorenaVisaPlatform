import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { ScorecardService } from './scorecard.service';
import { ScorecardController } from './scorecard.controller';
import { ScorecardPublicController } from './scorecard-public.controller';

// PR-SCORECARD-1 — Readiness Assessment scoring engine + lead pipeline.
//
// The TypeScript scoring engine port lives under ./scoring and is
// pure (no Nest dependencies) so the unit tests can import it
// directly without bootstrapping the Nest app.
//
// PR-SCORECARD-4: imports PlatformSettingsModule so the public
// /scorecard/booking-urls endpoint can resolve the OWNER-editable
// booking destinations.

@Module({
  imports: [PrismaModule, CryptoModule, PlatformSettingsModule],
  // ScorecardPublicController FIRST — its literal `booking-urls` path
  // must beat the authenticated controller's `:submissionId/booking-opened`
  // param routes when Nest matches.
  controllers: [ScorecardPublicController, ScorecardController],
  providers: [ScorecardService],
  exports: [ScorecardService],
})
export class ScorecardModule {}
