import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OpsHandoffsService } from './ops-handoffs.service';
import { OpsHandoffsController } from './ops-handoffs.controller';

// Phase 6 — OPS Handoffs exceptions monitor (GET /ops/handoffs/pending).
@Module({
  imports: [PrismaModule],
  controllers: [OpsHandoffsController],
  providers: [OpsHandoffsService],
  // PR-HANDOFFS: the Owner-dashboard Handoffs section (api/staff/handoffs)
  // reuses the exact staffing-exception rules from this service rather than
  // re-deriving them, so the two surfaces can never drift apart.
  exports: [OpsHandoffsService],
})
export class OpsHandoffsModule {}
