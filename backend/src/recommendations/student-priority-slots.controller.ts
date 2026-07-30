import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { EngagementPaidGuard } from '../common/guards/engagement-paid.guard';
import { PrioritySlotsService } from './priority-slots.service';
import { RecommendationsService } from './recommendations.service';
import { ReorderSlotsDto } from './dto/priority-slots.dto';

// PR-RECS-2 (slice 2) — the client's priority-slot screen.
//
// The client can ONLY reorder the finished set into their priority sequence, then
// confirm. They never add/remove/substitute programmes (staff-only). caseId is
// resolved server-side. Same guard stack as the admission form.
@Controller('student/priority-slots')
@UseGuards(JwtAuthGuard, RolesGuard, EngagementPaidGuard)
@Roles('STUDENT')
export class StudentPrioritySlotsController {
  constructor(
    private readonly slots: PrioritySlotsService,
    private readonly recs: RecommendationsService,
  ) {}

  @Get()
  async get(@Req() req: any) {
    const caseId = await this.recs.resolveCaseIdForStudent(this.uid(req));
    return this.slots.getPicker(caseId);
  }

  @Put('reorder')
  async reorder(@Req() req: any, @Body() dto: ReorderSlotsDto) {
    const caseId = await this.recs.resolveCaseIdForStudent(this.uid(req));
    return this.slots.clientReorder(caseId, dto.order, this.actor(req));
  }

  @Post('confirm')
  async confirm(@Req() req: any) {
    const caseId = await this.recs.resolveCaseIdForStudent(this.uid(req));
    return this.slots.confirm(caseId, this.actor(req));
  }

  private uid(req: any) { return req.user?.userId ?? req.user?.id; }
  private actor(req: any) {
    return { id: this.uid(req) ?? null, name: req.user?.name ?? null, role: req.user?.role ?? null };
  }
}
