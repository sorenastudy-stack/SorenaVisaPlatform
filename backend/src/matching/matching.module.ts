import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MatchingService } from './matching.service';
import { MatchingController } from './matching.controller';
import { PublicMatchingController } from './public-matching.controller';

@Module({
  imports: [PrismaModule],
  controllers: [MatchingController, PublicMatchingController],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
