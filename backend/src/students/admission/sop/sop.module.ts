import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AiModule } from '../../../ai/ai.module';
import { SopService } from './sop.service';
import { SopController } from './sop.controller';

// PR-ADMISSION-SOP (step 3) — AI SOP generation + review/gate/approve. AiModule exports the
// SopGenerationAgent (owns the drafting + adversarial gate-evaluation prompts).
@Module({
  imports: [PrismaModule, AiModule],
  controllers: [SopController],
  providers: [SopService],
})
export class SopModule {}
