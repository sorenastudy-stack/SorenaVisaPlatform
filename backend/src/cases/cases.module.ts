import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';

@Module({
  imports: [PrismaModule],
  controllers: [CasesController],
  providers: [CasesService, EventsService],
  exports: [CasesService],
})
export class CasesModule {}
