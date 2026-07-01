import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffRolesModule } from '../roles/staff-roles.module';
import { BookingCancellationModule } from '../../booking/booking-cancellation.module';
import { StaffBookingsController } from './staff-bookings.controller';
import { StaffBookingsService } from './staff-bookings.service';

// PR-WALLET slice 2 — staff bookings list + No-Show/Completed/Cancel marker.
@Module({
  imports: [PrismaModule, StaffRolesModule, BookingCancellationModule],
  controllers: [StaffBookingsController],
  providers: [StaffBookingsService],
})
export class StaffBookingsModule {}
