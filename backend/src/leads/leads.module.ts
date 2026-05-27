import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { StaffLeadsService } from './staff-leads.service';
import { StaffLeadsController } from './staff-leads.controller';

// PR-CRM-LEADS: StaffLeadsController + StaffLeadsService added
// alongside the existing /leads controller. They share the same
// Lead model; the new endpoints live under /staff/leads/* with the
// broader staff role gate. The original sales-side flow is
// preserved untouched.

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [LeadsController, StaffLeadsController],
  providers: [LeadsService, EventsService, StaffLeadsService],
  exports: [LeadsService, StaffLeadsService],
})
export class LeadsModule {}
