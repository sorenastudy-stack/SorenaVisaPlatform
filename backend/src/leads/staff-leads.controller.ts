import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { StaffLeadsService } from './staff-leads.service';

// PR-CRM-LEADS — Staff-side leads endpoints.
//
// Mounted under /staff/leads/*. Role gate is broad (OWNER /
// SUPER_ADMIN / ADMIN / CONSULTANT / FINANCE) — sales + support
// need to see the funnel. LIA is deliberately excluded: LIAs work
// from the case-side LIA portal, not the lead funnel.
//
// Status changes accept OWNER / SUPER_ADMIN / ADMIN / CONSULTANT.
// Reassignment is tighter (OWNER / SUPER_ADMIN / ADMIN) — only
// managers reassign.
//
// All routes use req.user?.userId ?? req.user?.id per d95640d.

@Controller('staff/leads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaffLeadsController {
  constructor(private readonly service: StaffLeadsService) {}

  @Get()
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'FINANCE')
  list(
    @Query('source') source?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('band') band?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.service.list({
      source, status, assignedToId, search, dateFrom, dateTo, band,
      limit:  limit  ? parseInt(limit, 10)  : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      sortBy: (sortBy as any) ?? undefined,
      sortOrder: (sortOrder as any) ?? undefined,
    });
  }

  // List of staff users eligible to receive a lead assignment. Used
  // by the assignment dropdown on the detail page + the list filter.
  @Get('assignees')
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'FINANCE')
  assignees() {
    return this.service.listAssignees();
  }

  @Get(':id')
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'FINANCE')
  detail(@Param('id') id: string, @Req() req: any) {
    return this.service.detail(id, this.actor(req));
  }

  @Patch(':id/status')
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; note?: string },
    @Req() req: any,
  ) {
    return this.service.updateStatus(id, body, this.actor(req));
  }

  @Patch(':id/assign')
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN')
  assign(
    @Param('id') id: string,
    @Body() body: { assignedToId: string | null },
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
