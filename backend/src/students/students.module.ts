import { Module } from '@nestjs/common';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { AdmissionController } from './admission/admission.controller';
import { AdmissionService } from './admission/admission.service';
import { ProgrammeChoiceRulesService } from './admission/programme-choice-rules.service';
import { VisaController } from './visa/visa.controller';
import { VisaService } from './visa/visa.service';
import { DashboardModule } from './dashboard/dashboard.module';
import { TicketsModule } from './tickets/tickets.module';
import { MeetingsModule } from './meetings/meetings.module';
import { ChatbotModule } from './chatbot/chatbot.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { EventsService } from '../events/events.service';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    CryptoModule,
    DashboardModule,
    TicketsModule,
    MeetingsModule,
    ChatbotModule,
  ],
  controllers: [StudentsController, AdmissionController, VisaController],
  providers: [StudentsService, AdmissionService, VisaService, ProgrammeChoiceRulesService, EventsService],
  exports: [StudentsService],
})
export class StudentsModule {}
