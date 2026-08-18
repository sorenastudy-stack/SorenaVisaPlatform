import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { R2Module } from '../common/r2/r2.module';
import { StaffRolesModule } from '../staff/roles/staff-roles.module';
import { DocumentsController } from './documents.controller';
import { StaffDocumentsController } from './staff-documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentScanService } from './document-scan.service';

// Documents step 3 — sibling top-level module. Imports PrismaModule
// (for Document + AuditLog access) and R2Module (for presigned
// uploads/downloads/deletes). Exports DocumentsService in case
// another module ever needs to attach files programmatically.
// PR-STAFF-DOCS: StaffRolesModule for the assignment-based "my documents"
// list controller (StaffRolesGuard).
// PR-AV slice 3: DocumentScanService is the poll job that scans presigned-upload
// documents after the fact. AntivirusModule is @Global, so it needs no import.
@Module({
  imports: [PrismaModule, R2Module, StaffRolesModule],
  controllers: [DocumentsController, StaffDocumentsController],
  providers: [DocumentsService, DocumentScanService],
  exports: [DocumentsService, DocumentScanService],
})
export class DocumentsModule {}
