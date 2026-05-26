import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { LiaAssignmentService } from './lia-assignment.service';
import { LiaRosterController } from './lia-roster.controller';
import { LiaProductivityService } from './lia-productivity.service';
import { LiaProductivityController } from './lia-productivity.controller';
import { InzSubmissionService } from './inz-submission/inz-submission.service';
import { InzSubmissionController } from './inz-submission/inz-submission.controller';
import { VisaService } from './visa/visa.service';
import { VisaController } from './visa/visa.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { CryptoModule } from '../common/crypto/crypto.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, CryptoModule, NotificationsModule],
  controllers: [
    CasesController,
    LiaRosterController,
    LiaProductivityController,
    InzSubmissionController,
    VisaController,
  ],
  providers: [
    CasesService,
    EventsService,
    LiaAssignmentService,
    LiaProductivityService,
    InzSubmissionService,
    VisaService,
  ],
  exports: [
    CasesService,
    LiaAssignmentService,
    LiaProductivityService,
    InzSubmissionService,
    VisaService,
  ],
})
export class CasesModule {}
