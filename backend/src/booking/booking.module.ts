import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';

// PR-BOOKING — native in-portal booking. Stage 3 wires the FREE_15 flow
// (controller + service). Paid types land in a later stage.
@Module({
  imports: [PrismaModule],
  controllers: [BookingController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
