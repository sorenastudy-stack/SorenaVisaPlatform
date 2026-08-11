import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OpsHandoffsModule } from '../ops-handoffs/ops-handoffs.module';
import { HandoffsService } from './handoffs.service';
import { HandoffsController } from './handoffs.controller';
import { CaseHandoffController } from './case-handoff.controller';
import { CaseHandoffService } from './case-handoff.service';
import { CasesModule } from '../cases/cases.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';

// PR-HANDOFFS — Owner-dashboard Handoffs (GET /api/staff/handoffs). Imports
// OpsHandoffsModule to reuse its staffing-exception rules; adds the three
// state-derived "stuck case" rules on top.
@Module({
  imports: [PrismaModule, OpsHandoffsModule, CasesModule, MailModule, NotificationsModule],
  controllers: [HandoffsController, CaseHandoffController],
  providers: [HandoffsService, CaseHandoffService],
  exports: [CaseHandoffService],
})
export class HandoffsModule {}
