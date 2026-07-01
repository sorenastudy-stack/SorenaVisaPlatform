import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { BookingCancellationService } from './booking-cancellation.service';

// PR-WALLET slice 2 — shared cancellation/refund service, used by both the
// client booking endpoints and the staff bookings marker. Standalone (imports
// only Prisma + Wallet) so both consumers can import it without a cycle.
@Module({
  imports: [PrismaModule, WalletModule],
  providers: [BookingCancellationService],
  exports: [BookingCancellationService],
})
export class BookingCancellationModule {}
