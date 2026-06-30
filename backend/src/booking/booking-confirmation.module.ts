import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BookingConfirmationService } from './booking-confirmation.service';

// PR-BOOKING-5 — confirm-finalize (Jitsi link + confirmation email).
// Standalone so both BookingModule (free confirm) and PaymentsModule
// (webhook confirm) can import it without a circular dependency.
// MailService is @Global, so no MailModule import is needed.
@Module({
  imports: [PrismaModule],
  providers: [BookingConfirmationService],
  exports: [BookingConfirmationService],
})
export class BookingConfirmationModule {}
