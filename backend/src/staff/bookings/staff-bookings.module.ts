import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffRolesModule } from '../roles/staff-roles.module';
import { BookingCancellationModule } from '../../booking/booking-cancellation.module';
import { PaymentsModule } from '../../payments/payments.module';
import { OwnerApprovalModule } from '../owner-approval/owner-approval.module';
import { StaffBookingsController } from './staff-bookings.controller';
import { SalesConsultationsController } from './sales-consultations.controller';
import { StaffBookingsService } from './staff-bookings.service';

// PR-WALLET slice 2 — staff bookings list + No-Show/Completed/Cancel marker.
// PR-CARD-REFUND (two-person) — PaymentsModule provides RefundService for the
// request-time pre-check; OwnerApprovalModule enqueues the ISSUE_REFUND request
// that an OWNER must approve before any money moves.
@Module({
  imports: [PrismaModule, StaffRolesModule, BookingCancellationModule, PaymentsModule, OwnerApprovalModule],
  // SalesConsultationsController is here rather than in its own module because
  // it reads through the same service; it just carries a different guard.
  controllers: [StaffBookingsController, SalesConsultationsController],
  providers: [StaffBookingsService],
})
export class StaffBookingsModule {}
