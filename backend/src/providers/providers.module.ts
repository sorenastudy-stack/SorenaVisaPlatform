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
  exports: [ProvidersService],
})
export class ProvidersModule {}
