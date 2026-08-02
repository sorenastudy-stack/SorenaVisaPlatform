import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SubmissionService } from './submission.service';
import { SubmissionController } from './submission.controller';

// PR-ADMISSION-SUBMIT (step 4) — per-institution Submission Log. No AI; pure data lifecycle.
@Module({
  imports: [PrismaModule],
  controllers: [SubmissionController],
  providers: [SubmissionService],
})
export class SubmissionModule {}
