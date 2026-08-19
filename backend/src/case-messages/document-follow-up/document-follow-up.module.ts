import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { DocumentFollowUpService } from './document-follow-up.service';
import { DocumentFollowUpCronService } from './document-follow-up-cron.service';

// PR-CHECKLIST item 3 — the 2-week client document chase. Its own module rather
// than more providers inside CaseMessagesModule, so CaseMessagesService can
// import the service to clear a notice inline without CaseMessagesModule also
// owning a cron. ScheduleModule.forRoot() is app-wide, so the @Cron is
// discovered without registering it here.
@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [DocumentFollowUpService, DocumentFollowUpCronService],
  exports: [DocumentFollowUpService],
})
export class DocumentFollowUpModule {}
