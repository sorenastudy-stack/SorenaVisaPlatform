import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OpsHandoffsModule } from '../ops-handoffs/ops-handoffs.module';
import { HandoffsService } from './handoffs.service';
import { HandoffsController } from './handoffs.controller';

// PR-HANDOFFS — Owner-dashboard Handoffs (GET /api/staff/handoffs). Imports
// OpsHandoffsModule to reuse its staffing-exception rules; adds the three
// state-derived "stuck case" rules on top.
@Module({
  imports: [PrismaModule, OpsHandoffsModule],
  controllers: [HandoffsController],
  providers: [HandoffsService],
})
export class HandoffsModule {}
