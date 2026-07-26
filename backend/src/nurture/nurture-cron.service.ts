import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NurtureService } from './nurture.service';

// PR-NURTURE — daily cron entrypoint. Mirrors VisaExpiryService: a thin @Cron
// wrapper that never throws out of the scheduler; all logic lives in
// NurtureService.runDailySweep() so it stays unit-testable with an injected clock.
//
// ScheduleModule.forRoot() is already registered app-wide (visa-expiry.module),
// so this @Cron is discovered without re-registering it here.
const TIMEZONE = 'Pacific/Auckland';

@Injectable()
export class NurtureCronService {
  private readonly logger = new Logger(NurtureCronService.name);

  constructor(private readonly nurture: NurtureService) {}

  // 09:15 NZ daily — just after the visa-expiry sweep (09:00), so the two
  // reminder jobs don't contend.
  @Cron('15 9 * * *', { name: 'nurtureDailySweep', timeZone: TIMEZONE })
  async runDailySweep(): Promise<void> {
    this.logger.log('[Nurture] Daily sweep started');
    try {
      const r = await this.nurture.runDailySweep();
      this.logger.log(
        `[Nurture] Processed ${r.processed} leads — ${r.emailsSent} emails, ` +
        `${r.callTasksCreated} call tasks, ${r.newslettersSent} newsletters, ${r.ended} ended`,
      );
    } catch (err: any) {
      this.logger.error(`[Nurture] Daily sweep crashed: ${err?.message ?? err}`, err?.stack);
    }
  }
}
