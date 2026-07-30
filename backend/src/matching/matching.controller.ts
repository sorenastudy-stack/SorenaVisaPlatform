import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MatchingService } from './matching.service';
import { MatchCriteriaDto } from './dto/match-criteria.dto';
import type { MatchCriteria } from './matching.logic';

// PR-PHASE32 — programme recommendations for an applicant. The Q30 field-
// relatedness rule + approved-only gating are enforced inside the service
// (server-side), so this endpoint is safe even if the client sends a criteria
// that was tampered with.
@Controller('matching')
@UseGuards(JwtAuthGuard)
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  @Post('recommendations')
  recommend(@Body() dto: MatchCriteriaDto) {
    return this.matching.recommend(dto as unknown as MatchCriteria);
  }
}
