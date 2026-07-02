import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffRolesModule } from '../roles/staff-roles.module';
import { BookingCancellationModule } from '../../booking/booking-cancellation.module';
import { PaymentsModule } from '../../payments/payments.module';
import { OwnerApprovalModule } from '../owner-approval/owner-approval.module';
import { StaffBookingsController } from './staff-bookings.controller';
import { StaffBookingsService } from './staff-bookings.service';

// PR-WALLET slice 2 — staff bookings list + No-Show/Completed/Cancel marker.
// PR-CARD-REFUND (two-person) — PaymentsModule provides RefundService for the
// request-time pre-check; OwnerApprovalModule enqueues the ISSUE_REFUND request
// that an OWNER must approve before any money moves.
@Module({
  imports: [PrismaModule, StaffRolesModule, BookingCancellationModule, PaymentsModule, OwnerApprovalModule],
  controllers: [StaffBookingsController],
  providers: [StaffBookingsService],
})
export class StaffBookingsModule {}
