import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OpsComplianceModule } from '../ops-compliance/ops-compliance.module';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';

// PR-COMPLIANCE — Owner-dashboard Compliance section (flagged cases + override
// audit slice). Read-only; composes existing signals.
@Module({
  imports: [PrismaModule, OpsComplianceModule],
  controllers: [ComplianceController],
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
