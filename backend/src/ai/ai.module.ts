import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { AiController } from './ai.controller';
import { ClaudeService } from './claude.service';
import { ComplianceGuardService } from './compliance-guard.service';
import { KnowledgeService } from './knowledge.service';
import { LeadQualificationAgent } from './agents/lead-qualification.agent';

@Module({
  imports: [PrismaModule],
  controllers: [AiController],
  providers: [
    ClaudeService,
    ComplianceGuardService,
    KnowledgeService,
    LeadQualificationAgent,
    EventsService,
  ],
  exports: [ClaudeService], // PR-CATALOG-2 — reused by the web-sync extraction service
})
export class AiModule {}
