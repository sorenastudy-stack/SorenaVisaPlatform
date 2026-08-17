import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ProgrammeImportService } from './import/programme-import.service';
import { PricingImportService } from './import/pricing-import.service';
import { ProgrammeCurationService } from './programme-curation.service';
import { WebSyncModule } from './websync/websync.module';
import { R2Module } from '../common/r2/r2.module';

@Module({
  imports: [PrismaModule, WebSyncModule, R2Module], // WebSyncModule exports CatalogSyncService (sync-now)
  controllers: [ProvidersController],
  providers: [ProvidersService, EventsService, RolesGuard, ProgrammeImportService, PricingImportService, ProgrammeCurationService],
  // PricingImportService/ProgrammeImportService are exported for the provider
  // portal's slice-C wrapper — it reaches the SAME importer instances staff use,
  // which is the point: one parser, one set of validation rules, one landing
  // state. A second copy would be a second thing to keep in step.
  exports: [ProvidersService, PricingImportService, ProgrammeImportService],
})
export class ProvidersModule {}
