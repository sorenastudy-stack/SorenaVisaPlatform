import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DiaryService } from './diary.service';
import { DiaryController } from './diary.controller';

// PR-DIARY — Client Officer daily agenda (today + missed). Read-only composition
// over NurtureCallTask + Consultation; no new tables, no action logic.
@Module({
  imports: [PrismaModule],
  controllers: [DiaryController],
  providers: [DiaryService],
})
export class DiaryModule {}
