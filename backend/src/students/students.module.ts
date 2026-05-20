import { Module } from '@nestjs/common';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { AdmissionController } from './admission/admission.controller';
import { AdmissionService } from './admission/admission.service';
import { VisaController } from './visa/visa.controller';
import { VisaService } from './visa/visa.service';
import { DashboardModule } from './dashboard/dashboard.module';
import { TicketsModule } from './tickets/tickets.module';
import { MeetingsModule } from './meetings/meetings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { CryptoModule } from '../common/crypto/crypto.module';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    CryptoModule,
    DashboardModule,
    TicketsModule,
    MeetingsModule,
  ],
  controllers: [StudentsController, AdmissionController, VisaController],
  providers: [StudentsService, AdmissionService, VisaService],
  exports: [StudentsService],
})
export class StudentsModule {}
