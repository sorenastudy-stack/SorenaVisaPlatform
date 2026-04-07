import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [PrismaModule],
  controllers: [ProvidersController],
  providers: [ProvidersService, EventsService, RolesGuard],
  exports: [ProvidersService],
})
export class ProvidersModule {}
