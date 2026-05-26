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
import { CaseFileNoteService } from './case-file-note/case-file-note.service';
import { CaseFileNoteController } from './case-file-note/case-file-note.controller';
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
    // PR-LIA-12: case-file-note timeline + Markdown/Text export.
    CaseFileNoteController,
  ],
  providers: [
    CasesService,
    EventsService,
    LiaAssignmentService,
    LiaProductivityService,
    InzSubmissionService,
    VisaService,
    CaseFileNoteService,
  ],
  exports: [
    CasesService,
    LiaAssignmentService,
    LiaProductivityService,
    InzSubmissionService,
    VisaService,
    CaseFileNoteService,
  ],
})
export class CasesModule {}
