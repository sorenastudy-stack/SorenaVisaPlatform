import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { R2Module } from '../common/r2/r2.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

// Documents step 3 — sibling top-level module. Imports PrismaModule
// (for Document + AuditLog access) and R2Module (for presigned
// uploads/downloads/deletes). Exports DocumentsService in case
// another module ever needs to attach files programmatically.
@Module({
  imports: [PrismaModule, R2Module],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
