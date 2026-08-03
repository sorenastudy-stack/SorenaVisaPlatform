import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { FollowUpModule } from '../follow-up/follow-up.module';
import { SubmissionService } from './submission.service';
import { SubmissionController } from './submission.controller';

// PR-ADMISSION-SUBMIT (step 4) — per-institution Submission Log. Imports FollowUpModule (step 5) so
// logging a response / removing an attempt clears its follow-up task inline.
@Module({
  imports: [PrismaModule, FollowUpModule],
  controllers: [SubmissionController],
  providers: [SubmissionService],
})
export class SubmissionModule {}
