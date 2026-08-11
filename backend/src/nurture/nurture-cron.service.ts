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

/**
 * DISARMED until the sequence copy is written.
 *
 * Steps 1/3/5/6 still carry placeholder bodies — literally "[Consultation
 * recap + pathway summary — copy TBD.]" — and this job is what would send them.
 * Nothing has gone out yet only because no lead has ever become a nurture
 * candidate: production has zero rows in leadNurtureSent and all 52 leads sit
 * at nurtureStage NONE. That is an accident of there being no candidates, not a
 * safeguard.
 *
 * And it is one-way. leadNurtureSent is the dedup anchor: once a step is
 * recorded for a lead, the correct copy can never be sent to that person for
 * that step. A single unlucky day would burn the first touch of the sequence
 * on whoever qualified.
 *
 * So the sweep is gated rather than deleted. Set NURTURE_SWEEP_ENABLED=true to
 * re-arm it — a one-line change once the copy exists. The @Cron registration
 * stays, so the schedule is still visible and the wiring cannot rot.
 */
const SWEEP_ENABLED = process.env.NURTURE_SWEEP_ENABLED === 'true';

@Injectable()
export class NurtureCronService {
  private readonly logger = new Logger(NurtureCronService.name);

  constructor(private readonly nurture: NurtureService) {}

  // 09:15 NZ daily — just after the visa-expiry sweep (09:00), so the two
  // reminder jobs don't contend.
  @Cron('15 9 * * *', { name: 'nurtureDailySweep', timeZone: TIMEZONE })
  async runDailySweep(): Promise<void> {
    if (!SWEEP_ENABLED) {
      // Logged, not silent: a job that quietly does nothing looks identical to
      // a job that is broken, and this one is meant to come back.
      this.logger.warn(
        '[Nurture] Daily sweep skipped — NURTURE_SWEEP_ENABLED is not "true". ' +
        'The sequence emails still contain placeholder copy; set it once they are written.',
      );
      return;
    }

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
