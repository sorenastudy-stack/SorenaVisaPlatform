import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { CaseDocumentsService } from './case-documents.service';
import { CaseDocumentsController } from './case-documents.controller';
import { OpsDocumentsController } from './ops-documents.controller';
import { StudentDocumentStatusService } from './student-document-status.service';
import { StudentDocumentStatusController } from './student-document-status.controller';

// PR-LIA-5 — Cross-source document listing + signed-URL downloads +
// internal-only review verdicts. OpsDocumentsController adds the OPS
// cross-case unreviewed queue (GET /ops/documents/unreviewed).
// Item 1 — StudentDocumentStatus* adds the STUDENT-facing read-only verdict
// view (GET /students/me/documents/review-status), owner-scoped by JWT userId.
@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [CaseDocumentsController, OpsDocumentsController, StudentDocumentStatusController],
  providers: [CaseDocumentsService, StudentDocumentStatusService],
  exports: [CaseDocumentsService],
})
export class CaseDocumentsModule {}
