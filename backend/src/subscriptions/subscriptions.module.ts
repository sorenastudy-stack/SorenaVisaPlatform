import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';

@Module({
  imports: [PrismaModule],
  providers: [SubscriptionsService, EventsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
