import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CatalogSyncService } from './catalog-sync.service';

// PR-CATALOG-2 — monthly cron entrypoint for the web re-sync. Thin @Cron wrapper that never
// throws out of the scheduler (mirrors NurtureCronService); all logic lives in
// CatalogSyncService.runSweep(). ScheduleModule.forRoot() is already registered app-wide
// (visa-expiry.module), so this @Cron is discovered without re-registering it.
const TIMEZONE = 'Pacific/Auckland';

@Injectable()
export class CatalogSyncCronService {
  private readonly logger = new Logger(CatalogSyncCronService.name);

  constructor(private readonly sync: CatalogSyncService) {}

  // 03:00 NZ on the 1st of each month — overnight/off-peak, well clear of the daily jobs.
  @Cron('0 3 1 * *', { name: 'catalogueWebSync', timeZone: TIMEZONE })
  async runMonthlySweep(): Promise<void> {
    this.logger.log('[CatalogSync] Monthly sweep started');
    try {
      const r = await this.sync.runSweep();
      this.logger.log(
        `[CatalogSync] Scanned ${r.providersScanned} providers, fetched ${r.pagesFetched} pages — ` +
          `${r.changeProposals} change proposals, ${r.candidatesCreated} new candidates ` +
          `(${r.lowConfidenceSkipped} low-confidence, ${r.cappedSkipped} capped, ${r.blocked.length} blocked)`,
      );
      for (const note of r.notes) this.logger.log(`[CatalogSync] ${note}`);
    } catch (err: any) {
      this.logger.error(`[CatalogSync] Monthly sweep crashed: ${err?.message ?? err}`, err?.stack);
    }
  }
}
