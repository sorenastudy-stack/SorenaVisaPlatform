import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { CaseMessagesService } from './case-messages.service';
import { CaseMessagesLiaController } from './case-messages.controller';
import { CaseMessagesStudentController } from './case-messages.student.controller';

// PR-LIA-4 — Direct LIA ↔ client messaging on CRM Cases. Two
// controllers share one service; the LIA side is mounted under
// /cases/:caseId/messages/* and the student side under
// /students/me/case-messages/*.
@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [CaseMessagesLiaController, CaseMessagesStudentController],
  providers: [CaseMessagesService],
  exports: [CaseMessagesService],
})
export class CaseMessagesModule {}
