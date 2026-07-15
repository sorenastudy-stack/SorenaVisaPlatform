import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OpsComplianceService } from './ops-compliance.service';
import { OpsComplianceController } from './ops-compliance.controller';

// Phase B — OPS Compliance exceptions monitor (GET /ops/compliance/non-compliant).
@Module({
  imports: [PrismaModule],
  controllers: [OpsComplianceController],
  providers: [OpsComplianceService],
})
export class OpsComplianceModule {}
