import { Module } from '@nestjs/common';
import { CommissionsController } from './commissions.controller';
import { CommissionTriggersController } from './commission-triggers.controller';
import { CommissionTriggersService } from './commission-triggers.service';
import { CommissionsService } from './commissions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [PrismaModule],
  controllers: [CommissionsController, CommissionTriggersController],
  providers: [CommissionsService, CommissionTriggersService, EventsService, RolesGuard],
  exports: [CommissionsService, CommissionTriggersService],
})
export class CommissionsModule {}
