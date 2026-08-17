import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProviderAccessGuard } from './provider-access.guard';
import { ProviderAnalyticsService } from './provider-analytics.service';

// PR-PROVIDER-PORTAL slice F — the institution's own performance panel.
//
// Read-only, one route, no id anywhere — back to the slice B/C shape, because
// there is nothing here to identify but the caller. No @Param, no @Query, no
// body: an institution cannot ask this endpoint about anyone.
@Controller('provider/analytics')
@UseGuards(JwtAuthGuard, RolesGuard, ProviderAccessGuard)
@Roles('PROVIDER')
export class ProviderAnalyticsController {
  constructor(private readonly service: ProviderAnalyticsService) {}

  @Get()
  overview(@Req() req: any) {
    return this.service.overview({ providerId: req.providerAccess.providerId });
  }
}
