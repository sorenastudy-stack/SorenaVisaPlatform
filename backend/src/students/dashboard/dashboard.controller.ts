import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

// PR-DASH-1 — Client-dashboard controller.
//
// Auth chain matches every other student-facing controller in the
// project: JwtAuthGuard + RolesGuard with @Roles('STUDENT'). Per-row
// ownership is enforced inside the service via the admission chain
// (Contact → Lead → Case → AdmissionApplication → VisaApplication),
// so a caller can only ever read their own data.
//
// Reads are intentionally NOT audit-logged — the dashboard is loaded
// on every page view and would flood the audit table. Mutation paths
// (status changes, auto-creation events on first load) ARE captured.
@Controller('students/me/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard(@Req() req: any) {
    return this.dashboardService.getDashboard(req.user.userId);
  }

  @Get('case')
  getCase(@Req() req: any) {
    return this.dashboardService.getCase(req.user.userId);
  }
}
