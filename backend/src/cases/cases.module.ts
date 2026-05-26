import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { LiaAssignmentService } from './lia-assignment.service';
import { LiaRosterController } from './lia-roster.controller';
import { LiaProductivityService } from './lia-productivity.service';
import { LiaProductivityController } from './lia-productivity.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { CryptoModule } from '../common/crypto/crypto.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, CryptoModule, NotificationsModule],
  controllers: [CasesController, LiaRosterController, LiaProductivityController],
  providers: [CasesService, EventsService, LiaAssignmentService, LiaProductivityService],
  exports: [CasesService, LiaAssignmentService, LiaProductivityService],
})
export class CasesModule {}
