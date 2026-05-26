import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { LiaAssignmentService } from './lia-assignment.service';
import { LiaRosterController } from './lia-roster.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { CryptoModule } from '../common/crypto/crypto.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, CryptoModule, NotificationsModule],
  controllers: [CasesController, LiaRosterController],
  providers: [CasesService, EventsService, LiaAssignmentService],
  exports: [CasesService, LiaAssignmentService],
})
export class CasesModule {}
