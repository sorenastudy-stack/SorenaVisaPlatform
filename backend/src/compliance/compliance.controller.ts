import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ComplianceService } from './compliance.service';

// PR-COMPLIANCE — Owner-dashboard Compliance data.
//
// Gated to OWNER / SUPER_ADMIN (the Operations Manual's Compliance-Admin tier —
// the same gate as /admin/audit). Read-only; every action a row references is
// performed elsewhere (the case, the audit browser, the approvals queue).
@Controller('api/staff/compliance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN')
export class ComplianceController {
  constructor(private readonly service: ComplianceService) {}

  @Get('flagged-cases')
  flaggedCases() {
    return this.service.listFlaggedCases();
  }

  @Get('override-log')
  overrideLog(@Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 50;
    return this.service.listOverrideAuditLog(Number.isFinite(n) ? n : 50);
  }
}
