import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { WebinarsController } from './webinars.controller';
import { WebinarsService } from './webinars.service';
import { WebinarApiKeyGuard } from './guards/webinar-api-key.guard';
import { EventsService } from '../events/events.service';
import { WebinarsRecurrenceCron } from './webinars-recurrence.cron';
import { WebinarEmailLifecycleService } from './webinar-email-lifecycle.service';

// PR-WEBINAR-1 — Webinar registration module. Receives the sorenavisa.com
// website's registration calls (see webinars.controller.ts) and exposes the
// public upcoming-webinars list.
//
// EventsService is provided locally, same as WixWebhooksModule — it is a leaf
// service several modules instantiate directly rather than import a shared
// EventsModule for.
//
// PR-WEBINAR-2: WebinarsRecurrenceCron auto-advances recurring series
// (`recurrenceDays` set) to their next occurrence. No ScheduleModule.forRoot()
// here — it is already registered app-wide by VisaExpiryModule.
@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [WebinarsController],
  providers: [
    WebinarsService,
    WebinarApiKeyGuard,
    EventsService,
    WebinarsRecurrenceCron,
    WebinarEmailLifecycleService,
  ],
})
export class WebinarsModule {}
