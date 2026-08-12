import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentAccessGuard } from './agent-access.guard';

// PR-AGENT-PORTAL phase 1 — the external agent's portal.
//
// Its own module rather than part of marketing/: that module is the OWNER's
// view of agents (create, pause, issue tracking links). This one is the
// agent's own view of themselves, reached by a different role through a
// different gate. Keeping them apart is what stops an Owner-facing query
// drifting into an agent-facing route by proximity.
@Module({
  imports: [PrismaModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentAccessGuard],
  exports: [AgentsService],
})
export class AgentsModule {}
