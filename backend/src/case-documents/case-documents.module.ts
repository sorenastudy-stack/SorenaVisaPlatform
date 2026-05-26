import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { CaseDocumentsService } from './case-documents.service';
import { CaseDocumentsController } from './case-documents.controller';

// PR-LIA-5 — Cross-source document listing + signed-URL downloads +
// internal-only review verdicts.
@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [CaseDocumentsController],
  providers: [CaseDocumentsService],
  exports: [CaseDocumentsService],
})
export class CaseDocumentsModule {}
