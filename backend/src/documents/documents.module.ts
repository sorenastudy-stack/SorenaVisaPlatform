import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { R2Module } from '../common/r2/r2.module';
import { StaffRolesModule } from '../staff/roles/staff-roles.module';
import { DocumentsController } from './documents.controller';
import { StaffDocumentsController } from './staff-documents.controller';
import { DocumentsService } from './documents.service';

// Documents step 3 — sibling top-level module. Imports PrismaModule
// (for Document + AuditLog access) and R2Module (for presigned
// uploads/downloads/deletes). Exports DocumentsService in case
// another module ever needs to attach files programmatically.
// PR-STAFF-DOCS: StaffRolesModule for the assignment-based "my documents"
// list controller (StaffRolesGuard).
@Module({
  imports: [PrismaModule, R2Module, StaffRolesModule],
  controllers: [DocumentsController, StaffDocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
