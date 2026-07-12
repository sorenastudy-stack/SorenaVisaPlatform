import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

// OWNER audit-log browser — read-only view over the existing AuditLog
// (GET /admin/audit + /admin/audit/:id). OWNER/SUPER_ADMIN only. No new
// audit machinery, no migration.
@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
