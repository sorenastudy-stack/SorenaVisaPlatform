import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SubscriptionsModule, PrismaModule, NotificationsModule],
  controllers: [PaymentsController],
  providers: [StripeService, PaymentsService, EventsService],
  exports: [StripeService, PaymentsService],
})
export class PaymentsModule {}
