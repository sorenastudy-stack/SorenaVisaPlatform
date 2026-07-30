import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { MatchCriteriaDto } from './dto/match-criteria.dto';
import type { MatchCriteria } from './matching.logic';

// PR-PHASE33 — public (pre-account) recommendations for the redesigned
// assessment funnel. No auth guard (the assessment is anonymous, like the
// scorecard); still rate-limited by the global ThrottlerGuard. Safe to expose:
// the service only ever returns APPROVED programmes from ACTIVE providers, and
// the Q30 field-relatedness rule is re-derived server-side (bypass-proof).
@Controller('public/matching')
export class PublicMatchingController {
  constructor(private readonly matching: MatchingService) {}

  @Post('recommendations')
  recommend(@Body() dto: MatchCriteriaDto) {
    return this.matching.recommend(dto as unknown as MatchCriteria);
  }

  // Taxonomy for the Q13 / Q32 pickers.
  @Get('study-fields')
  studyFields() {
    return this.matching.listStudyFields();
  }

  // Server-authoritative Q30 allowed set for Q32 filtering.
  @Get('allowed-fields')
  allowedFields(@Query('qualificationFieldId') qualificationFieldId?: string) {
    return this.matching.allowedFieldIdsFor(qualificationFieldId ?? null);
  }
}
