import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AiModule } from '../../../ai/ai.module';
import { CvService } from './cv.service';
import { CvController } from './cv.controller';

// PR-ADMISSION-CV (step 2b) — AI CV generation + review/approve. AiModule exports ClaudeService.
@Module({
  imports: [PrismaModule, AiModule],
  controllers: [CvController],
  providers: [CvService],
})
export class CvModule {}
