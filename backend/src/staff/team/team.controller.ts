import {
  Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { AdminTier } from '../roles/staff-roles.decorator';
import { TeamService } from './team.service';
import {
  UpdateStaffProfileDto, ReplaceAvailabilityDto, CreateStaffLeaveDto,
} from './dto/team.dto';

// PR-BOOKING-ADMIN-A — adviser management endpoints.
//
// Mounted at /staff/team, admin-tier only (OWNER/SUPER_ADMIN/ADMIN)
// via @AdminTier() + StaffRolesGuard (which also enforces the staff
// active-status check). Configures booking for existing LIA/CONSULTANT
// users; it does not create users.
@Controller('staff/team')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
@AdminTier()
export class TeamController {
  constructor(private readonly service: TeamService) {}

  // GET /staff/team — list adviser-eligible users + booking summary.
  @Get()
  list() {
    return this.service.list();
  }

  // GET /staff/team/:id — one adviser's full config + weekly windows.
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  // PATCH /staff/team/:id — update languages / timezone / types / active.
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStaffProfileDto) {
    return this.service.updateProfile(id, dto);
  }

  // PUT /staff/team/:id/availability — replace the full weekly set.
  @Put(':id/availability')
  replaceAvailability(@Param('id') id: string, @Body() dto: ReplaceAvailabilityDto) {
    return this.service.replaceAvailability(id, dto.windows);
  }

  // ── Leave / time-off (PR-BOOKING-ADMIN-B, Stage B slice 1) ───────────
  // Admin-direct path only for now: created APPROVED. The request→approve
  // lifecycle is modelled in the schema but its endpoints land in slice 2.

  // POST /staff/team/:id/leave — set leave directly (status APPROVED).
  // Returns { leave, conflicts } — conflicts are existing BOOKED/CONFIRMED
  // sessions inside the leave; they are surfaced, never modified.
  @Post(':id/leave')
  createLeave(
    @Param('id') id: string,
    @Body() dto: CreateStaffLeaveDto,
    @Req() req: any,
  ) {
    return this.service.createLeave(id, dto, req.user.userId);
  }

  // GET /staff/team/:id/leave?status= — list this adviser's leave.
  @Get(':id/leave')
  listLeave(@Param('id') id: string, @Query('status') status?: string) {
    return this.service.listLeave(id, status);
  }

  // DELETE /staff/team/:id/leave/:leaveId — remove/cancel a leave.
  @Delete(':id/leave/:leaveId')
  deleteLeave(@Param('id') id: string, @Param('leaveId') leaveId: string) {
    return this.service.deleteLeave(id, leaveId);
  }
}
