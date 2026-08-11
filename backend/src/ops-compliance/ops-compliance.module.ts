import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OpsComplianceService } from './ops-compliance.service';

// PR-OPS-RETIRE — the /ops route is gone; this module now exists only to provide
// the service, which the Compliance controller reuses at api/staff/compliance.
@Module({
  imports: [PrismaModule],
  providers: [OpsComplianceService],
  exports: [OpsComplianceService],
})
export class OpsComplianceModule {}
