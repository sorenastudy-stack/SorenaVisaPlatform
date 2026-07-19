import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { StaffRoles, AdminTier, STAFF_PORTAL_ROLES } from '../roles/staff-roles.decorator';
import { AssignmentsService } from './assignments.service';
import {
  AutoAllocateDto,
  ManualAssignDto,
  WorkloadQueryDto,
  AvailableStaffQueryDto,
} from './dto/assignments.dto';
import {
  AutoAllocateRateLimitGuard,
  ManualAssignRateLimitGuard,
} from './guards/assignments-rate-limit.guards';

// PR-CONSULT-1 — Assignments controller.
//
// `auto-allocate`, `manual-assign`, and `available-staff` are
// admin-tier only (OWNER / SUPER_ADMIN / ADMIN). `case/:id` and
// `workload` are readable by any active staff (case-detail uses
// the LIA / CONSULTANT slots; workload uses caller's own data
// unless they're admin-tier and pass ?staffId=).
@Controller('api/staff/assignments')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post('auto-allocate')
  @AdminTier()
  @UseGuards(AutoAllocateRateLimitGuard)
  autoAllocate(@Req() req: any, @Body() body: AutoAllocateDto) {
    return this.assignments.autoAllocate(
      body.caseId,
      body.roleSlot as never,
      req.user.userId,
    );
  }

  @Post('manual-assign')
  @AdminTier()
  @UseGuards(ManualAssignRateLimitGuard)
  manualAssign(@Req() req: any, @Body() body: ManualAssignDto) {
    return this.assignments.manualAssign(
      body.caseId,
      body.roleSlot as never,
      body.staffId,
      req.user.userId,
    );
  }

  @Get('case/:caseId')
  @StaffRoles(...STAFF_PORTAL_ROLES)
  getCaseAssignments(@Param('caseId') caseId: string) {
    return this.assignments.getCaseAssignments(caseId);
  }

  @Get('workload')
  @StaffRoles(...STAFF_PORTAL_ROLES)
  async getWorkload(@Req() req: any, @Query() query: WorkloadQueryDto) {
    // Non-admin staff can only see their own workload. Admin-tier
    // can pass ?staffId= to see anyone's.
    const role = req.user.role;
    const adminTier = ['OWNER', 'SUPER_ADMIN', 'ADMIN'].includes(role);
    const target = query.staffId && adminTier ? query.staffId : req.user.userId;
    return this.assignments.getStaffWorkload(target);
  }

  @Get('available-staff')
  @AdminTier()
  available(@Query() query: AvailableStaffQueryDto) {
    return this.assignments.listAvailableStaffForRole(query.roleSlot as never);
  }
}
