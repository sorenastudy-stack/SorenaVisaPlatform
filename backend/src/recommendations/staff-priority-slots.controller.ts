import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrioritySlotsService } from './priority-slots.service';
import { StaffSwapSlotDto } from './dto/priority-slots.dto';

// PR-RECS-2 (slice 2) — Admission-Specialist priority-slot review.
//
// The Specialist reviews the auto-filled slate and may SWAP which programme sits
// at a position (subject to the same type rules — a swap that would put a
// University in the mandatory-Polytechnic slot is rejected with structured errors).
@Controller('staff/cases/:caseId/priority-slots')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'CLIENT_CONSULTANT')
export class StaffPrioritySlotsController {
  constructor(private readonly slots: PrioritySlotsService) {}

  @Get()
  get(@Param('caseId') caseId: string) {
    return this.slots.getForStaff(caseId);
  }

  @Put()
  swap(@Param('caseId') caseId: string, @Body() dto: StaffSwapSlotDto, @Req() req: any) {
    return this.slots.staffSwap(caseId, dto.position, dto.programmeId ?? null, this.actor(req));
  }

  private actor(req: any) {
    return { id: req.user?.userId ?? req.user?.id ?? null, name: req.user?.name ?? null, role: req.user?.role ?? null };
  }
}
