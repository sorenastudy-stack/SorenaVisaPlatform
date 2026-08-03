import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FollowUpService } from './follow-up.service';

// PR-ADMISSION-FOLLOWUP (step 5) — daily cron entrypoint. Thin @Cron wrapper that never throws out
// of the scheduler; all logic lives in FollowUpService.runDailySweep() (injected clock → testable).
// ScheduleModule.forRoot() is registered app-wide (visa-expiry.module), so this @Cron is discovered
// without re-registering it here.
const TIMEZONE = 'Pacific/Auckland';

@Injectable()
export class FollowUpCronService {
  private readonly logger = new Logger(FollowUpCronService.name);
  constructor(private readonly followUp: FollowUpService) {}

  // 09:30 NZ daily — after the visa-expiry (09:00) and nurture (09:15) sweeps, so the reminder
  // jobs don't contend.
  @Cron('30 9 * * *', { name: 'submissionFollowUpSweep', timeZone: TIMEZONE })
  async runDailySweep(): Promise<void> {
    this.logger.log('[FollowUp] Daily submission follow-up sweep started');
    try {
      const r = await this.followUp.runDailySweep();
      this.logger.log(`[FollowUp] ${r.created} follow-up task(s) created, ${r.resolved} resolved`);
    } catch (err: any) {
      this.logger.error(`[FollowUp] Daily sweep crashed: ${err?.message ?? err}`, err?.stack);
    }
  }
}
