import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { StripeService } from './stripe.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';

@Module({
  imports: [SubscriptionsModule, PrismaModule],
  controllers: [PaymentsController],
  providers: [StripeService, EventsService],
  exports: [StripeService],
})
export class PaymentsModule {}
