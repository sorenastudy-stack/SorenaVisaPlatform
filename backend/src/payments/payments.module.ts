import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { CasesModule } from '../cases/cases.module';

@Module({
  // PR-LIA-AUTO-ASSIGN: CasesModule exports LiaAssignmentService for the
  // ACCOUNT_OPENING-payment auto-assignment hook (mirrors ContractsModule).
  imports: [SubscriptionsModule, PrismaModule, NotificationsModule, CasesModule],
  controllers: [PaymentsController],
  providers: [StripeService, PaymentsService, EventsService],
  exports: [StripeService, PaymentsService],
})
export class PaymentsModule {}
