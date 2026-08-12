import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AgentAccessGuard } from './agent-access.guard';
import { AgentsService } from './agents.service';

// PR-AGENT-PORTAL phase 1 — the agent's own surface.
//
// Three layers, and they answer three different questions:
//   JwtAuthGuard      are you anybody?
//   @Roles('AGENT')   are you the kind of person who may ask?
//   AgentAccessGuard  are you allowed to do anything yet?
//
// The third is per-route rather than class-level ON PURPOSE: /me must answer
// for a blocked agent, or somebody who cannot get in has no way to find out
// why. Everything that returns data carries it.
@Controller('agent')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('AGENT')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  private userId(req: any): string | null {
    return req.user?.userId ?? req.user?.id ?? null;
  }

  /**
   * Who am I and what is outstanding. Deliberately ungated.
   *
   * Carries no client data of any kind — not even counts — so being blocked
   * reveals nothing about the business waiting on the other side.
   */
  @Get('me')
  me(@Req() req: any) {
    return this.agents.me(this.userId(req));
  }

  /**
   * The clients this agent introduced.
   *
   * `req.agentAccess` is set by the guard that just ran. Reading the agent id
   * from there rather than resolving it again is what stops the gate and the
   * ownership filter from ever disagreeing about who the caller is.
   */
  @Get('leads')
  @UseGuards(AgentAccessGuard)
  leads(@Req() req: any) {
    return this.agents.leads(req.agentAccess.agentId);
  }

  @Get('payables')
  @UseGuards(AgentAccessGuard)
  payables(@Req() req: any) {
    return this.agents.payables(req.agentAccess.agentId);
  }
}
