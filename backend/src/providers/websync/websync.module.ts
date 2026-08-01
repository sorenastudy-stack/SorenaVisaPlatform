import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiModule } from '../../ai/ai.module';
import { PageFetchService } from './page-fetch.service';
import { ProgrammeExtractionService } from './programme-extraction.service';
import { CatalogSyncService } from './catalog-sync.service';
import { CatalogSyncCronService } from './catalog-sync-cron.service';

// PR-CATALOG-2 — the monthly web re-sync (Piece 2). AiModule exports ClaudeService, which
// the extraction service reuses. The @Cron in CatalogSyncCronService is discovered via the
// app-wide ScheduleModule.forRoot(). CatalogSyncService is exported so a manual "sync now"
// trigger (providers controller) can reach it.
@Module({
  imports: [PrismaModule, AiModule],
  providers: [PageFetchService, ProgrammeExtractionService, CatalogSyncService, CatalogSyncCronService],
  exports: [CatalogSyncService],
})
export class WebSyncModule {}
