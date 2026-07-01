import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { StaffRoles } from '../roles/staff-roles.decorator';
import { StaffLeaveService } from './staff-leave.service';
import { CreateStaffLeaveDto } from '../team/dto/team.dto';

// PR-BOOKING-ADMIN-B slice 2 — staff self-service leave (own requests).
//
// Mounted at /staff/me/leave. Open to every active staff member (same
// allow-list as /api/staff/me). The acting staff member is ALWAYS the JWT
// user — staffId is never read from the body — so a caller can only ever
// request / list / withdraw their OWN leave. Approval is elsewhere (Team
// panel, ADMIN/OWNER only).
@Controller('staff/me/leave')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class StaffLeaveController {
  constructor(private readonly service: StaffLeaveService) {}

  // POST /staff/me/leave — raise a request (status REQUESTED).
  @Post()
  @StaffRoles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE')
  request(@Body() dto: CreateStaffLeaveDto, @Req() req: any) {
    return this.service.requestOwn(req.user.userId, dto);
  }

  // GET /staff/me/leave — the caller's own leave (all statuses).
  @Get()
  @StaffRoles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE')
  listMine(@Req() req: any) {
    return this.service.listOwn(req.user.userId);
  }

  // DELETE /staff/me/leave/:id — withdraw own pending request (→ CANCELLED).
  @Delete(':id')
  @StaffRoles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE')
  withdraw(@Param('id') id: string, @Req() req: any) {
    return this.service.withdrawOwn(req.user.userId, id);
  }
}
