import { Controller, Get, Param, Query, UseGuards, Req } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertCaseReadable } from '../cases/assert-case-read';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RecommendationsService, type RecommendationSort } from './recommendations.service';

// PR-RECS-1 (slice 1) — Admission-Specialist (CONSULTANT) + admin-tier read of a
// case's recommendation list. Read-only this slice. Mirrors the case-scoped read
// roles used elsewhere on the staff surface.
@Controller('staff/cases/:caseId/recommendations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'CLIENT_CONSULTANT')
export class StaffRecommendationsController {
  constructor(private readonly service: RecommendationsService, private readonly prisma: PrismaService) {}

  @Get()
  async current(
    @Param('caseId') caseId: string,
    @Req() req: any,
    @Query('sort') sort?: string,
  ) {
    await assertCaseReadable(this.prisma, caseId, {
      userId: req.user?.userId ?? req.user?.id,
      role: req.user?.role,
    });
    // No markViewed — staff viewing shouldn't flip the client's GENERATED→VIEWED state.
    return this.service.getCurrentForCase(caseId, (sort as RecommendationSort) ?? 'default', false);
  }
}
