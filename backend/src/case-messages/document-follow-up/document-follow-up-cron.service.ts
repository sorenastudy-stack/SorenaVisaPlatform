import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DocumentFollowUpService } from './document-follow-up.service';

// PR-CHECKLIST item 3 — daily entrypoint. Thin wrapper that never throws out of
// the scheduler; the logic lives in the service behind an injected clock so it
// is testable without waiting a fortnight.
const TIMEZONE = 'Pacific/Auckland';

@Injectable()
export class DocumentFollowUpCronService {
  private readonly logger = new Logger(DocumentFollowUpCronService.name);

  constructor(private readonly followUp: DocumentFollowUpService) {}

  // 09:45 NZ — after visa-expiry (09:00), nurture (09:15) and the institution
  // follow-up (09:30), so the morning reminder jobs do not contend.
  @Cron('45 9 * * *', { name: 'clientDocumentFollowUpSweep', timeZone: TIMEZONE })
  async runDailySweep(): Promise<void> {
    try {
      const r = await this.followUp.runDailySweep();
      this.logger.log(`[ClientDocFollowUp] ${r.created} follow-up notification(s) raised`);
    } catch (err: any) {
      this.logger.error(`[ClientDocFollowUp] Daily sweep crashed: ${err?.message ?? err}`, err?.stack);
    }
  }
}
