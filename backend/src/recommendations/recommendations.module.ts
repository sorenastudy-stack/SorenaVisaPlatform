import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MatchingModule } from '../matching/matching.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { EventsService } from '../events/events.service';
import { RecommendationsService } from './recommendations.service';
import { StudentRecommendationsController } from './student-recommendations.controller';
import { StaffRecommendationsController } from './staff-recommendations.controller';
import { ScorecardCriteriaResolver } from '../matching/criteria/scorecard-criteria.resolver';
import { MATCH_CRITERIA_RESOLVER } from '../matching/criteria/match-criteria-resolver';

// PR-RECS-1 (slice 1) — persisted recommendation lists.
//
// The resolveMatchCriteria seam is bound here: MATCH_CRITERIA_RESOLVER → the
// /scorecard reverse-map impl (Impl A). Swapping to the v2 /assessment impl later
// is a one-line change here — the service/controllers are untouched.
@Module({
  imports: [PrismaModule, MatchingModule, CryptoModule],
  controllers: [StudentRecommendationsController, StaffRecommendationsController],
  providers: [
    RecommendationsService,
    EventsService,
    ScorecardCriteriaResolver,
    { provide: MATCH_CRITERIA_RESOLVER, useExisting: ScorecardCriteriaResolver },
  ],
})
export class RecommendationsModule {}
