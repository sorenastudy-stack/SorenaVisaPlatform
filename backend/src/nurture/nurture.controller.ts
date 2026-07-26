import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { NurtureService } from './nurture.service';
import { CompleteCallTaskDto, EnrollNurtureDto, NurtureOverrideDto, StopNurtureDto } from './dto/nurture.dto';

// PR-NURTURE — staff surface. The Client Officer who ran a FREE_15 enrols a
// "not ready" lead, sees their own open call tasks, logs outcomes, and can stop a
// sequence early. Admin tier sees/acts across all Client Officers.
@Controller('staff/nurture')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'CLIENT_CONSULTANT')
export class NurtureController {
  constructor(private readonly nurture: NurtureService) {}

  private actor(req: any) {
    return { userId: req.user?.userId ?? req.user?.id, role: req.user?.role ?? '', name: req.user?.name ?? null };
  }

  // POST /staff/nurture/:leadId/override — CO manual ADVANCE / POSTPONE of the
  // automated nurture cadence (pre-contract only). Mandatory reason; audited.
  @Post(':leadId/override')
  override(@Param('leadId') leadId: string, @Body() dto: NurtureOverrideDto, @Req() req: any) {
    return this.nurture.manualOverride(leadId, dto.direction, dto.reason, dto.holdDays ?? null, this.actor(req));
  }

  // POST /staff/nurture/enroll — "mark not ready" → start the 21-day sequence.
  @Post('enroll')
  enroll(@Body() dto: EnrollNurtureDto, @Req() req: any) {
    return this.nurture.enroll(dto.leadId, dto.reason ?? null, this.actor(req));
  }

  // POST /staff/nurture/stop — end the sequence early (e.g. the lead replied).
  @Post('stop')
  stop(@Body() dto: StopNurtureDto, @Req() req: any) {
    return this.nurture.stopNurture(dto.leadId, this.actor(req));
  }

  // GET /staff/nurture/my-tasks — the caller's open call tasks, oldest-due first
  // (admin tier sees all).
  @Get('my-tasks')
  myTasks(@Req() req: any) {
    return this.nurture.listMyCallTasks(this.actor(req));
  }

  // POST /staff/nurture/tasks/:id/outcome — log a call outcome (DONE | SKIPPED).
  @Post('tasks/:id/outcome')
  completeTask(@Param('id') id: string, @Body() dto: CompleteCallTaskDto, @Req() req: any) {
    return this.nurture.completeCallTask(id, this.actor(req), dto.status, dto.outcomeNotes ?? null);
  }

  // POST /staff/nurture/run-sweep-now — manual trigger (ops/testing). Admin tier
  // only; the RolesGuard on the class allows CONSULTANT too, so re-gate here.
  @Post('run-sweep-now')
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN')
  runSweep() {
    return this.nurture.runDailySweep();
  }
}
