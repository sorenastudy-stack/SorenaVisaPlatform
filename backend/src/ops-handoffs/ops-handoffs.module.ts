import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OpsHandoffsService } from './ops-handoffs.service';
import { OpsHandoffsController } from './ops-handoffs.controller';

// Phase 6 — OPS Handoffs exceptions monitor (GET /ops/handoffs/pending).
@Module({
  imports: [PrismaModule],
  controllers: [OpsHandoffsController],
  providers: [OpsHandoffsService],
})
export class OpsHandoffsModule {}
