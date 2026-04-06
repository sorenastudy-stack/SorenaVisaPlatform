import { Module } from '@nestjs/common';
import { IntakeService } from './intake.service';
import { IntakeController, ScoringController } from './intake.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ScoringService } from '../scoring/scoring.service';
import { HighRiskEngineService } from '../scoring/high-risk-engine.service';
import { EventsService } from '../events/events.service';

@Module({
  imports: [PrismaModule],
  controllers: [IntakeController, ScoringController],
  providers: [IntakeService, ScoringService, HighRiskEngineService, EventsService],
  exports: [IntakeService, ScoringService, HighRiskEngineService],
})
export class IntakeModule {}
