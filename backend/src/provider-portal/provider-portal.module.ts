import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { R2Module } from '../common/r2/r2.module';
import { ProvidersModule } from '../providers/providers.module';
import { EventsService } from '../events/events.service';
import { ProviderPortalController } from './provider-portal.controller';
import { ProviderPortalService } from './provider-portal.service';
import { ProviderImportController } from './provider-import.controller';
import { ProviderImportService } from './provider-import.service';
import { ProviderProgrammeController } from './provider-programme.controller';
import { ProviderProgrammeService } from './provider-programme.service';
import { ProviderProgrammePricingService } from './provider-programme-pricing.service';
import { NationalityGroupController } from './nationality-group.controller';
import { NationalityGroupService } from './nationality-group.service';
import { ProviderAnalyticsController } from './provider-analytics.controller';
import { ProviderAnalyticsService } from './provider-analytics.service';
import { ProviderMarketingController } from './provider-marketing.controller';
import { ProviderMarketingService } from './provider-marketing.service';
import { ProviderAccessGuard } from './provider-access.guard';

// PR-PROVIDER-PORTAL slice B — the institution-facing surface, deliberately its
// own module so nothing staff-side can accidentally mount a route inside the
// ownership boundary.
// Slice C imports ProvidersModule for the EXISTING importers rather than
// reimplementing them — the wrapper adds the ownership boundary and the
// external-upload constraints, and nothing else.
@Module({
  imports: [PrismaModule, ProvidersModule, R2Module],
  controllers: [
    ProviderPortalController, ProviderImportController, ProviderProgrammeController,
    NationalityGroupController, ProviderAnalyticsController, ProviderMarketingController,
  ],
  providers: [
    ProviderPortalService, ProviderImportService, ProviderProgrammeService, ProviderProgrammePricingService, NationalityGroupService, ProviderAnalyticsService,
    ProviderMarketingService,
    ProviderAccessGuard, EventsService,
  ],
})
export class ProviderPortalModule {}
