import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AffiliateAgentsService } from './affiliate-agents.service';
import { TrackingLinksService } from './tracking-links.service';
import { MarketingController } from './marketing.controller';
import { ShortLinkController } from './short-link.controller';

// PR-SCORECARD-2 — Marketing / affiliate link tracking module.
//
// Two controllers: the staff CRUD surface (`/staff/marketing/*`, role
// gated) and the public short-link redirector (`/s/:shortCode`, no auth).
//
// `TrackingLinksService` is exported so the ScorecardService can read
// the sv_attribution cookie at submit time and resolve it to an
// AffiliateAgent. We re-export AffiliateAgentsService too for symmetry,
// even though no one consumes it externally today.

@Module({
  imports: [PrismaModule],
  controllers: [MarketingController, ShortLinkController],
  providers: [AffiliateAgentsService, TrackingLinksService],
  exports: [AffiliateAgentsService, TrackingLinksService],
})
export class MarketingModule {}
