import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { StaffRoles } from '../roles/staff-roles.decorator';
import { StaffHrService } from './staff-hr.service';

// PR-STAFF-HR (Phase 3) — staff HR self-service (own contract + job description).
//
// Mounted at /staff/me/*, open to every active staff role (same allow-list as
// /api/staff/me and /staff/me/leave). The acting staff member is ALWAYS the
// JWT user, so a caller can only ever read their OWN HR data. Admin
// upload/set-for-others lives on a separate ADMIN-tier surface.
@Controller('staff/me')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class StaffHrController {
  constructor(private readonly service: StaffHrService) {}

  // GET /staff/me/contract — metadata for the caller's own contract.
  @Get('contract')
  @StaffRoles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE')
  contract(@Req() req: any) {
    return this.service.myContract(req.user.userId);
  }

  // GET /staff/me/contract/download — short-lived signed URL for own contract.
  @Get('contract/download')
  @StaffRoles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE')
  contractDownload(@Req() req: any) {
    return this.service.myContractDownloadUrl(req.user.userId);
  }

  // GET /staff/me/job-description — the caller's own admin-set job description.
  @Get('job-description')
  @StaffRoles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE')
  jobDescription(@Req() req: any) {
    return this.service.myJobDescription(req.user.userId);
  }
}
