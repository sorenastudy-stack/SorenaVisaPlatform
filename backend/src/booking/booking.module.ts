import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { BookingHoldCleanupService } from './booking-hold-cleanup.service';
import { BookingConfirmationModule } from './booking-confirmation.module';
import { WalletModule } from '../wallet/wallet.module';

// PR-BOOKING — native in-portal booking. Stage 3 wired FREE_15; Stage 4
// (slice 1) adds GAP_CLOSING paid booking (hold + Stripe Checkout +
// webhook confirm). PaymentsModule is imported for StripeService.
@Module({
  imports: [PrismaModule, PaymentsModule, BookingConfirmationModule, WalletModule],
  controllers: [BookingController],
  providers: [BookingService, BookingHoldCleanupService],
  exports: [BookingService],
})
export class BookingModule {}
