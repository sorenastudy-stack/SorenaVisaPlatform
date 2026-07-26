import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SlaService } from './sla.service';
import { SlaConfigController, SlaReportController } from './sla.controller';

// PR-SLA — Owner-manageable stage deadlines + the overdue-by-officer report.
// Exports SlaService so KanbanModule can attach deadline/overdue to case cards.
@Module({
  imports: [PrismaModule],
  controllers: [SlaConfigController, SlaReportController],
  providers: [SlaService],
  exports: [SlaService],
})
export class SlaModule {}
