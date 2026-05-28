import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { StaffTicketsService } from './staff-tickets.service';
import {
  AddStaffMessageDto,
  AssignTicketDto,
  UpdateTicketStatusDto,
} from './dto/staff-tickets.dto';
import { StaffTicketMessageRateLimitGuard } from './guards/staff-ticket-message-rate-limit.guard';

// PR-SUPPORT-1 — Staff-side ticket endpoints.
//
// Mounted under /staff/tickets/*. Class-level JwtAuthGuard +
// RolesGuard mirror the leads staff controller. Per-route @Roles
// pins exactly which UserRole values pass.
//
// The 6 staff roles allowed on the read + reply + status endpoints
// (OWNER / SUPER_ADMIN / ADMIN / SUPPORT / CONSULTANT / LIA) are the
// roles that can legitimately read a case's tickets — this is the
// support team plus the management tier. Reassignment is tighter
// (drops CONSULTANT and LIA) because reassignment is a workload-
// allocation decision, not a casework decision.
//
// All routes use req.user?.userId ?? req.user?.id per d95640d.

@Controller('staff/tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaffTicketsController {
  constructor(private readonly service: StaffTicketsService) {}

  @Get()
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'CONSULTANT', 'LIA')
  list(
    @Req() req: any,
    @Query('status')     status?: string,
    @Query('department') department?: string,
    @Query('assigned')   assigned?: string,
    @Query('search')     search?: string,
    @Query('limit')      limit?: string,
    @Query('offset')     offset?: string,
  ) {
    return this.service.list(
      {
        status, department, assigned, search,
        limit:  limit  ? parseInt(limit, 10)  : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      },
      this.actor(req),
    );
  }

  // /assignees must come BEFORE /:id so Nest matches the literal
  // segment first.
  @Get('assignees')
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'CONSULTANT', 'LIA')
  assignees() {
    return this.service.listAssignees();
  }

  @Get(':id')
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'CONSULTANT', 'LIA')
  detail(@Param('id') id: string, @Req() req: any) {
    return this.service.detail(id, this.actor(req));
  }

  @Post(':id/messages')
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'CONSULTANT', 'LIA')
  @UseGuards(StaffTicketMessageRateLimitGuard)
  addMessage(
    @Param('id') id: string,
    @Body() body: AddStaffMessageDto,
    @Req() req: any,
  ) {
    return this.service.addStaffMessage(id, body, this.actor(req));
  }

  @Patch(':id/status')
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'CONSULTANT', 'LIA')
  updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateTicketStatusDto,
    @Req() req: any,
  ) {
    return this.service.updateStatus(id, body, this.actor(req));
  }

  @Patch(':id/assign')
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT')
  assign(
    @Param('id') id: string,
    @Body() body: AssignTicketDto,
    @Req() req: any,
  ) {
    return this.service.assign(id, body, this.actor(req));
  }

  private actor(req: any) {
    return {
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
