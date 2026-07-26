import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SlaService } from './sla.service';
import { UpdateSlaConfigDto } from './dto/sla.dto';

// PR-SLA — Owner-manageable stage deadlines.
//   • /staff/settings/sla   — the editable config table (OWNER/SUPER_ADMIN).
//   • /staff/sla-report     — overdue cases grouped by Client Officer (owner tier).

@Controller('staff/settings/sla')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN')
export class SlaConfigController {
  constructor(private readonly sla: SlaService) {}

  @Get()
  list() {
    return this.sla.listConfig();
  }

  @Patch()
  update(@Body() dto: UpdateSlaConfigDto, @Req() req: any) {
    return this.sla.updateConfig(dto.institutionType, dto.stage, dto.slaDays, req.user?.userId ?? req.user?.id ?? null);
  }
}

@Controller('staff/sla-report')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN')
export class SlaReportController {
  constructor(private readonly sla: SlaService) {}

  @Get()
  report() {
    return this.sla.getOverdueByOfficer();
  }
}
