import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { EngagementPaidGuard } from '../common/guards/engagement-paid.guard';
import { RecommendationsService, type RecommendationSort } from './recommendations.service';

// PR-RECS-1 (slice 1) — the student's own recommendation list.
//
// Same guard stack as the admission form: authenticated STUDENT + engagement-paid
// gate. The caseId is resolved server-side from the logged-in user — never taken
// from the client. No slot logic here (slice 2).
@Controller('student/recommendations')
@UseGuards(JwtAuthGuard, RolesGuard, EngagementPaidGuard)
@Roles('STUDENT')
export class StudentRecommendationsController {
  constructor(private readonly service: RecommendationsService) {}

  @Post('generate')
  async generate(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    const caseId = await this.service.resolveCaseIdForStudent(userId);
    return this.service.generateForCase(caseId, userId, {
      id: userId, name: req.user?.name ?? null, role: req.user?.role ?? null,
    });
  }

  // PR-RECS-PHASE1 — suggestions for the Apply/Study screen. Read-only, and
  // empty until the student has made their own choice (enforced in the service).
  @Get('for-admission')
  async forAdmission(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    const caseId = await this.service.resolveCaseIdForStudent(userId);
    return this.service.getSuggestionsForAdmission(caseId, userId);
  }

  @Get()
  async current(@Req() req: any, @Query('sort') sort?: string) {
    const userId = req.user?.userId ?? req.user?.id;
    const caseId = await this.service.resolveCaseIdForStudent(userId);
    return this.service.getCurrentForCase(caseId, (sort as RecommendationSort) ?? 'default', true);
  }
}
