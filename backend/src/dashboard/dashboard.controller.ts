import { Controller, Get, Post, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  getSummary() {
    return this.dashboardService.getSummary();
  }

  @Get('leads/pipeline')
  getLeadPipeline(
    @Query('status') status?: string,
    @Query('scoreBand') scoreBand?: string,
    @Query('ownerId') ownerId?: string,
    @Query('country') country?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.dashboardService.getLeadPipeline({
      status: status as any,
      scoreBand: scoreBand as any,
      ownerId,
      country,
      dateFrom,
      dateTo,
    });
  }

  @Get('commissions')
  getCommissions() {
    return this.dashboardService.getCommissions();
  }

  @Get('commissions/reminders')
  getCommissionReminders() {
    return this.dashboardService.getCommissionReminders();
  }

  @Post('commissions/:id/confirm-commencement')
  @Roles('OPERATIONS', 'SUPER_ADMIN')
  confirmCommencement(@Param('id') id: string, @Req() req: any) {
    return this.dashboardService.confirmCommencement(id, req.user?.id ?? null);
  }

  @Get('providers')
  getProviders() {
    return this.dashboardService.getProviders();
  }

  @Get('consultations')
  getConsultations() {
    return this.dashboardService.getConsultations();
  }

  @Get('applications')
  getApplications() {
    return this.dashboardService.getApplications();
  }
}
