import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { MailModule } from '../mail/mail.module';
import { CasesModule } from '../cases/cases.module';
import { BookingConfirmationModule } from '../booking/booking-confirmation.module';

@Module({
  // PR-LIA-AUTO-ASSIGN: CasesModule exports LiaAssignmentService for the
  // ACCOUNT_OPENING-payment auto-assignment hook (mirrors ContractsModule).
  // PR-BOOKING-5: BookingConfirmationModule for the paid-booking webhook
  // finalize (Jitsi link + confirmation email). Standalone module — no
  // BookingModule⇄PaymentsModule cycle.
  imports: [SubscriptionsModule, PrismaModule, MailModule, CasesModule, BookingConfirmationModule],
  controllers: [PaymentsController],
  providers: [StripeService, PaymentsService, EventsService],
  exports: [StripeService, PaymentsService],
})
export class PaymentsModule {}
