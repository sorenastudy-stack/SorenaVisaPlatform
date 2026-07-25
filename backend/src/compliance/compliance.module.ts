import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';

// PR-COMPLIANCE — Owner-dashboard Compliance section (flagged cases + override
// audit slice). Read-only; composes existing signals.
@Module({
  imports: [PrismaModule],
  controllers: [ComplianceController],
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
