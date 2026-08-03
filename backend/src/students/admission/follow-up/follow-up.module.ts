import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { FollowUpService } from './follow-up.service';
import { FollowUpCronService } from './follow-up-cron.service';

// PR-ADMISSION-FOLLOWUP (step 5) — the 5-working-day institution follow-up. Exports FollowUpService
// so SubmissionModule can resolve a follow-up task inline when a response is logged / an attempt is
// removed. ScheduleModule.forRoot() is app-wide, so the @Cron in FollowUpCronService is discovered.
@Module({
  imports: [PrismaModule],
  providers: [FollowUpService, FollowUpCronService],
  exports: [FollowUpService],
})
export class FollowUpModule {}
