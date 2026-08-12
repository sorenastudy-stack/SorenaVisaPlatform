import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CommissionTriggersService,
  TRIGGER_DECIDE_ROLES,
  TRIGGER_SUBMIT_ROLES,
} from './commission-triggers.service';
import { ApproveTriggerDto, ConfirmAttendanceDto, RejectTriggerDto } from './dto/commission-trigger.dto';

// PR-COMMISSION-TRIGGER — two audiences, two gates.
//
// The Admission Officer (CONSULTANT in code, "Admission Officer" on screen)
// confirms attendance and submits the claim on their own cases. Finance decides.
// Neither can do the other's half: the whole point of the Manual's split is that
// the person who claims the money is not the person who approves it.
//
// ADMIN appears in the SUBMIT set only, matching the sibling admission-milestone
// routes (staff/cases/:caseId/offers and /submissions), and appears nowhere in
// the DECIDE set — commission access for ADMIN is unchanged by this feature.
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommissionTriggersController {
  constructor(private readonly triggers: CommissionTriggersService) {}

  private actor(req: any) {
    return {
      id: req.user?.userId ?? req.user?.id ?? null,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
      secondaryRoles: req.user?.secondaryRoles ?? [],
    };
  }

  // Sits under the case, alongside the other admission milestones, because that
  // is where the officer already works the case.
  @Post('staff/cases/:caseId/programme-choices/:choiceId/first-class-attended')
  @Roles(...TRIGGER_SUBMIT_ROLES)
  confirmAttendance(
    @Param('caseId') caseId: string,
    @Param('choiceId') choiceId: string,
    @Body() dto: ConfirmAttendanceDto,
    @Req() req: any,
  ) {
    return this.triggers.confirmFirstClassAttended(
      caseId,
      choiceId,
      dto.attendedAt ? new Date(dto.attendedAt) : null,
      this.actor(req),
    );
  }

  @Get('staff/commission-triggers/awaiting-attendance')
  @Roles(...TRIGGER_SUBMIT_ROLES)
  awaitingAttendance(@Req() req: any) {
    return this.triggers.listAwaitingAttendance(this.actor(req));
  }

  @Get('staff/commission-triggers/eligible')
  @Roles(...TRIGGER_SUBMIT_ROLES)
  eligible(@Req() req: any) {
    return this.triggers.listEligible(this.actor(req));
  }

  @Post('staff/commission-triggers')
  @Roles(...TRIGGER_SUBMIT_ROLES)
  submit(@Body() body: { programmeChoiceId: string }, @Req() req: any) {
    return this.triggers.submit(body?.programmeChoiceId, this.actor(req));
  }

  @Get('staff/commission-triggers/pending')
  @Roles(...TRIGGER_DECIDE_ROLES)
  pending(@Req() req: any) {
    return this.triggers.listPending(this.actor(req));
  }

  @Patch('staff/commission-triggers/:id/approve')
  @Roles(...TRIGGER_DECIDE_ROLES)
  approve(@Param('id') id: string, @Body() dto: ApproveTriggerDto, @Req() req: any) {
    return this.triggers.approve(id, dto, this.actor(req));
  }

  @Patch('staff/commission-triggers/:id/reject')
  @Roles(...TRIGGER_DECIDE_ROLES)
  reject(@Param('id') id: string, @Body() dto: RejectTriggerDto, @Req() req: any) {
    return this.triggers.reject(id, dto.reason, this.actor(req));
  }
}
