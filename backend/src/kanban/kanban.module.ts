import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SlaModule } from '../sla/sla.module';
import { KanbanService } from './kanban.service';
import { KanbanController } from './kanban.controller';

// PR-CO-KANBAN — Client Officer daily task kanban (GET /staff/kanban) + staff/CO
// raise-ticket (POST /staff/tickets). The manual ADVANCE/POSTPONE override lives in
// NurtureModule (POST /staff/nurture/:leadId/override).
@Module({
  imports: [PrismaModule, SlaModule],
  controllers: [KanbanController],
  providers: [KanbanService],
})
export class KanbanModule {}
