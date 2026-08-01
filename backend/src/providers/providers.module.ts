import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ProgrammeImportService } from './import/programme-import.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProvidersController],
  providers: [ProvidersService, EventsService, RolesGuard, ProgrammeImportService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
