import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsService } from '../events/events.service';
import { AiController } from './ai.controller';
import { ClaudeService } from './claude.service';
import { ComplianceGuardService } from './compliance-guard.service';
import { KnowledgeService } from './knowledge.service';
import { LeadQualificationAgent } from './agents/lead-qualification.agent';
import { CvGenerationAgent } from './agents/cv-generation.agent';
import { SopGenerationAgent } from './agents/sop-generation.agent';

@Module({
  imports: [PrismaModule],
  controllers: [AiController],
  providers: [
    ClaudeService,
    ComplianceGuardService,
    KnowledgeService,
    LeadQualificationAgent,
    CvGenerationAgent,
    SopGenerationAgent,
    EventsService,
  ],
  // PR-CATALOG-2 — ClaudeService reused by web-sync. PR-ADMISSION-CV — CvGenerationAgent
  // reused by CvService. PR-ADMISSION-SOP — SopGenerationAgent reused by SopService (the
  // SOP-document lifecycle orchestrator).
  exports: [ClaudeService, CvGenerationAgent, SopGenerationAgent],
})
export class AiModule {}
