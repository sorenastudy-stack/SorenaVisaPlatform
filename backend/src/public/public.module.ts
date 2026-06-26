import { Module } from '@nestjs/common';
import { PublicService } from './public.service';
import { PublicController } from './public.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { ScoringService } from '../scoring/scoring.service';
import { HighRiskEngineService } from '../scoring/high-risk-engine.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [PublicController],
  providers: [PublicService, EventsService, ScoringService, HighRiskEngineService],
})
export class PublicModule {}