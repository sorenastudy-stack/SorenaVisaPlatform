import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ComplianceService } from './compliance.service';
import { OpsComplianceService } from '../ops-compliance/ops-compliance.service';

// PR-COMPLIANCE — Owner-dashboard Compliance data.
//
// Gated to OWNER / SUPER_ADMIN (the Operations Manual's Compliance-Admin tier —
// the same gate as /admin/audit). Read-only; every action a row references is
// performed elsewhere (the case, the audit browser, the approvals queue).
//
// PR-OPS-RETIRE — the contract-exception list moved here from
// /ops/compliance/non-compliant. The Compliance page needed all three lists but
// reached the third through a route gated to a different, wider audience
// (OPERATIONS/ADMIN), so one page depended on two definitions of who it was for.
// It is now gated like the rest of the page. Nothing loses access in practice:
// OPERATIONS has no users, and no UI path put an ADMIN on this page.
@Controller('api/staff/compliance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN')
export class ComplianceController {
  constructor(
    private readonly service: ComplianceService,
    private readonly opsCompliance: OpsComplianceService,
  ) {}

  @Get('flagged-cases')
  flaggedCases() {
    return this.service.listFlaggedCases();
  }

  // Active cases carrying a contract exception. Same payload as the retired
  // /ops/compliance/non-compliant, same service — only the route and gate moved.
  @Get('non-compliant')
  nonCompliant() {
    return this.opsCompliance.listNonCompliant();
  }

  @Get('override-log')
  overrideLog(@Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 50;
    return this.service.listOverrideAuditLog(Number.isFinite(n) ? n : 50);
  }
}
