import { Module } from '@nestjs/common';
import { CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [PrismaModule],
  controllers: [CommissionsController],
  providers: [CommissionsService, EventsService, RolesGuard],
  exports: [CommissionsService],
})
export class CommissionsModule {}
