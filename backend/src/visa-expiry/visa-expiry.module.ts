import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VisaExpiryService } from './visa-expiry.service';
import { VisaExpiryController } from './visa-expiry.controller';

// PR-LIA-9 — Visa expiry reminder cron + dashboard endpoints.
//
// ScheduleModule.forRoot() is registered HERE (not in AppModule) so
// the schedule subsystem only spins up when this module loads. That
// keeps test suites that import a subset of the app graph from
// inadvertently scheduling background work.
//
// VisaExpiryService is exported so other modules could later trigger
// the sweep programmatically (e.g. from an admin-tooling endpoint).

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    NotificationsModule,
  ],
  providers: [VisaExpiryService],
  controllers: [VisaExpiryController],
  exports: [VisaExpiryService],
})
export class VisaExpiryModule {}
