import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExploreController } from './explore.controller';
import { ExploreService } from './explore.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ContentMatchingAgent } from '../ai/agents/content-matching.agent';
import { YoutubeCorpusService } from '../ai/agents/youtube-corpus.service';
import { ClaudeService } from '../ai/claude.service';

// PR-EXPLORE — wires ContentMatchingAgent to a caller for the first time. It
// and YoutubeCorpusService already existed but nothing referenced them, so the
// YOUTUBE_API_KEY configured in every environment was never being used.
@Module({
  imports: [PrismaModule],
  controllers: [ExploreController],
  providers: [ExploreService, RolesGuard, ContentMatchingAgent, YoutubeCorpusService, ClaudeService],
})
export class ExploreModule {}
