import { BadRequestException, Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { AdminTier, StaffRoles, StaffRole } from '../roles/staff-roles.decorator';
import { StaffCasesService } from './staff-cases.service';
import { StaffCasesListQueryDto } from './dto/staff-cases.dto';

// PR-CONSULT-2 — Staff cases controller.
//
// All routes guarded by JwtAuthGuard + StaffRolesGuard. Any of the
// 7 staff roles can call them; the service enforces the per-row
// visibility rule (admin tier sees all; LIA / CONSULTANT / SUPPORT /
// FINANCE see only cases where they hold an active assignment).
@Controller('api/staff/cases')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class StaffCasesController {
  constructor(private readonly cases: StaffCasesService) {}

  @Get()
  @StaffRoles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE')
  list(@Req() req: any, @Query() query: StaffCasesListQueryDto) {
    return this.cases.listCases(
      { userId: req.user.userId, role: req.user.role as StaffRole },
      {
        status:       query.status,
        assignedToMe: query.assignedToMe === 'true',
        q:            query.q,
        page:         query.page,
        pageSize:     query.pageSize,
      },
    );
  }

  // Option 1 step 3b — Reassign overlay candidate list. Declared
  // BEFORE @Get(':id') so 'eligible-staff' isn't matched as an id.
  // Step 4b widened the accepted slots to all 4 (Case-side schema now
  // has supportId + financeId columns).
  @Get('eligible-staff')
  @AdminTier()
  eligibleStaff(@Query('slot') slot: string) {
    if (slot !== 'LIA' && slot !== 'CONSULTANT' && slot !== 'SUPPORT' && slot !== 'FINANCE') {
      throw new BadRequestException('slot must be LIA, CONSULTANT, SUPPORT, or FINANCE');
    }
    return this.cases.listEligibleStaff(slot);
  }

  @Get(':id')
  @StaffRoles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE')
  detail(@Req() req: any, @Param('id') id: string) {
    return this.cases.getCaseDetail(
      { userId: req.user.userId, role: req.user.role as StaffRole },
      id,
    );
  }

  @Get(':id/activity')
  @StaffRoles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE')
  activity(@Req() req: any, @Param('id') id: string) {
    return this.cases.getCaseActivity(
      { userId: req.user.userId, role: req.user.role as StaffRole },
      id,
    );
  }
}
