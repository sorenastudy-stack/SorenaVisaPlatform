import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OfficerMetricsService } from './officer-metrics.service';

// PR-LIA-11 — Officer Metrics endpoints.
//
// Two role-gating tiers:
//   * Platform-wide metrics (GET /officers/metrics, /metrics/outliers):
//     OWNER / ADMIN / SUPER_ADMIN only. Cross-officer comparison is
//     OWNER-level visibility — LIAs don't see peer leaderboards.
//   * Per-officer trend (GET /officers/:id/metrics): LIA + above.
//     Officer-level analytics are part of the shared knowledge base
//     established by PR-LIA-10 (Decision 2C — observations are shared).
//
// Read-only — no audit rows written for queries. The audit helper
// has a registered OFFICER_OUTLIER_SCAN_RUN event type for a future
// manual-trigger pattern; this PR doesn't add such an endpoint.
//
// Route ordering: this controller is registered BEFORE
// ImmigrationOfficersController in the module so the /metrics literal
// segment is matched before /:id. (NestJS matches routes in
// controller-declaration order; the /:id route in the other
// controller would otherwise swallow /metrics.)

@Controller('officers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OfficerMetricsController {
  constructor(private readonly service: OfficerMetricsService) {}

  // GET /officers/metrics?windowMonths=6|12
  @Get('metrics')
  @Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')
  platform(@Query('windowMonths') windowMonths?: string) {
    const w = parseInt(windowMonths ?? '6', 10);
    const clamped = w === 12 ? 12 : 6;
    return this.service.getPlatformMetrics(clamped);
  }

  // GET /officers/metrics/outliers
  @Get('metrics/outliers')
  @Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')
  outliers() {
    return this.service.getPlatformOutliers();
  }

  // GET /officers/:id/metrics?windowMonths=6|12
  // NOTE: this is matched before ImmigrationOfficersController's
  // GET /:id because of controller-declaration order in the module.
  @Get(':id/metrics')
  @Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
  officerTrend(
    @Param('id') id: string,
    @Query('windowMonths') windowMonths?: string,
  ) {
    const w = parseInt(windowMonths ?? '6', 10);
    const clamped = w === 12 ? 12 : 6;
    return this.service.getOfficerTrend(id, clamped);
  }
}
