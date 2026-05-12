import { Module } from '@nestjs/common';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { AdmissionController } from './admission/admission.controller';
import { AdmissionService } from './admission/admission.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { CryptoModule } from '../common/crypto/crypto.module';

@Module({
  imports: [PrismaModule, EmailModule, CryptoModule],
  controllers: [StudentsController, AdmissionController],
  providers: [StudentsService, AdmissionService],
  exports: [StudentsService],
})
export class StudentsModule {}
