import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';

@Module({
  imports: [PrismaModule],
  controllers: [LeadsController],
  providers: [LeadsService, EventsService],
  exports: [LeadsService],
})
export class LeadsModule {}
