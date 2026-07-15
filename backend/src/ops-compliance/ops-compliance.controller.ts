import { Controller, Get, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OpsComplianceService } from './ops-compliance.service';

// Phase B — OPS Compliance exceptions monitor. Cross-case read allowed ONLY for
// OPERATIONS + admin tier (the SEE_ALL tier), enforced server-side here — same
// gate as OPS Handoffs / Documents, so the /ops layout is not the only barrier.
// Read-only: OPS holds no write power; each row links to the case for an admin
// to act. A tighter per-endpoint throttle sits on top of the global 60/min/IP
// baseline (this is a heavier cross-case aggregation than a typical read).
@Controller('ops/compliance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OPERATIONS', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
@Throttle({ default: { ttl: 60000, limit: 30 } })
export class OpsComplianceController {
  constructor(private readonly service: OpsComplianceService) {}

  // GET /ops/compliance/non-compliant — active cases with a contract exception.
  @Get('non-compliant')
  nonCompliant() {
    return this.service.listNonCompliant();
  }
}
