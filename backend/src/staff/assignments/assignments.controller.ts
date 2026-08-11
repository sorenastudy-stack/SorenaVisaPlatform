import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { hasRole } from '../../auth/role.util';
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
    //
    // PR-ACCESS-AUDIT — two changes, neither of which widened anything:
    //
    // hasRole, not `includes(req.user.role)`. Every other gate in this codebase
    // widens with secondaryRoles, and this one did not, so a user granted ADMIN
    // as a secondary role was refused a view their role entitles them to.
    //
    // And asking for someone else's workload without the standing to see it is
    // now refused rather than quietly answered with your own numbers. The old
    // fallback returned a different person's workload than the one requested,
    // under the requested person's name on the page — a wrong answer is worse
    // than a refusal.
    const adminTier = hasRole(req.user, 'OWNER', 'SUPER_ADMIN', 'ADMIN');
    if (query.staffId && query.staffId !== req.user.userId && !adminTier) {
      throw new ForbiddenException('You can only view your own workload.');
    }
    return this.assignments.getStaffWorkload(query.staffId ?? req.user.userId);
  }

  @Get('available-staff')
  @AdminTier()
  available(@Query() query: AvailableStaffQueryDto) {
    return this.assignments.listAvailableStaffForRole(query.roleSlot as never);
  }
}
