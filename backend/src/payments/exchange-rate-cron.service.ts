import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ExchangeRateService } from './exchange-rate.service';

// PR-PHASE40 — daily FX fetch. Mirrors NurtureCronService: a thin @Cron wrapper
// that never throws out of the scheduler, with all logic in the service so it
// stays unit-testable.
//
// ScheduleModule.forRoot() is already registered app-wide (visa-expiry.module),
// so this @Cron is discovered without re-registering it.
const TIMEZONE = 'Pacific/Auckland';

@Injectable()
export class ExchangeRateCronService {
  private readonly logger = new Logger(ExchangeRateCronService.name);

  constructor(private readonly rates: ExchangeRateService) {}

  // 05:30 NZ daily — well before the working day, so the rate is in place
  // before anyone raises an invoice, and clear of the 09:00 / 09:15 reminder
  // jobs.
  @Cron('30 5 * * *', { name: 'dailyExchangeRate', timeZone: TIMEZONE })
  async fetchDailyRate(): Promise<void> {
    const rate = await this.rates.fetchAndStoreDailyRate();
    if (rate === null) {
      // Already logged with the cause by the service. Repeated here at WARN so
      // the miss is visible in the cron narrative too — a silent failure would
      // surface days later as invoices carrying a stale rate.
      this.logger.warn('[FX] Daily fetch failed — invoices will use the most recent stored rate');
    }
  }
}
