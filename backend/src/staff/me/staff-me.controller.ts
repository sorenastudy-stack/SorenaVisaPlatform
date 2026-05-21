import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { StaffRoles } from '../roles/staff-roles.decorator';
import { StaffMeService } from './staff-me.service';

// PR-CONSULT-2 — `/api/staff/me` controller.
//
// Single GET endpoint. JwtAuthGuard puts the userId on req.user;
// StaffRolesGuard verifies the role + active-status check.
@Controller('api/staff/me')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class StaffMeController {
  constructor(private readonly me: StaffMeService) {}

  @Get()
  @StaffRoles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE')
  get(@Req() req: any) {
    return this.me.getMe(req.user.userId);
  }
}
