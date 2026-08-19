import { Module } from '@nestjs/common';
import { CommissionsController } from './commissions.controller';
import { CommissionTriggersController } from './commission-triggers.controller';
import { CommissionTriggersService } from './commission-triggers.service';
import { AgentPayablesController } from './agent-payables.controller';
import { AgentPayablesService } from './agent-payables.service';
import { CommissionsService } from './commissions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule, PrismaModule],
  controllers: [CommissionsController, CommissionTriggersController, AgentPayablesController],
  providers: [CommissionsService, CommissionTriggersService, AgentPayablesService, EventsService, RolesGuard],
  exports: [CommissionsService, CommissionTriggersService, AgentPayablesService],
})
export class CommissionsModule {}
