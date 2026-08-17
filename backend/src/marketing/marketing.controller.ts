import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AffiliateAgentsService } from './affiliate-agents.service';
import { TrackingLinksService } from './tracking-links.service';
import {
  AffiliateAgentStatus,
  ChangeAgentStatusDto,
  CreateAffiliateAgentDto,
  CreateTrackingLinkDto,
  MarketingChannelType,
  TrackingLinkStatus,
  UpdateAffiliateAgentDto,
} from './dto/marketing.dto';
import { SetAgentRateDto } from './dto/set-agent-rate.dto';
import { ClearAgentContractDto } from './dto/clear-agent-contract.dto';

// PR-SCORECARD-2 — Staff-facing marketing endpoints.
//
// Role gate: OWNER + ADMIN + SUPER_ADMIN ONLY. LIA, CONSULTANT,
// FINANCE, SUPPORT, SALES, STUDENT, LEAD are all DENIED at the guard
// — the marketing surface is a commercial / acquisition tool, not a
// case-management tool. Agent delete is OWNER-only (sub-gated in the
// service + here).

@Controller('staff/marketing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')
export class MarketingController {
  constructor(
    private readonly agents: AffiliateAgentsService,
    private readonly links: TrackingLinksService,
  ) {}

  // ─── Agents ───────────────────────────────────────────────────────

  @Get('agents')
  listAgents(
    @Query('status') status?: AffiliateAgentStatus,
    @Query('search') search?: string,
  ) {
    return this.agents.list({ status, search });
  }

  @Get('agents/:id')
  getAgent(@Param('id') id: string) {
    return this.agents.get(id);
  }

  // PR-AGENT-PORTAL-2 — the agent's own audit trail, read-only.
  @Get('agents/:id/history')
  agentHistory(@Param('id') id: string) {
    return this.agents.history(id);
  }

  @Post('agents')
  createAgent(@Body() dto: CreateAffiliateAgentDto, @Req() req: any) {
    return this.agents.create(dto, this.actor(req));
  }

  @Patch('agents/:id')
  updateAgent(
    @Param('id') id: string,
    @Body() dto: UpdateAffiliateAgentDto,
    @Req() req: any,
  ) {
    return this.agents.update(id, dto, this.actor(req));
  }

  @Patch('agents/:id/status')
  changeAgentStatus(
    @Param('id') id: string,
    @Body() dto: ChangeAgentStatusDto,
    @Req() req: any,
  ) {
    return this.agents.changeStatus(id, dto.status, this.actor(req));
  }

  // PR-AGENT-PORTAL-2 — set or clear the agent's commission rate.
  // OWNER only (the service re-checks), bounds-validated by the DTO, and audited
  // as AFFILIATE_AGENT_RATE_CHANGED with the old value alongside the new.
  @Patch('agents/:id/rate')
  @Roles('OWNER')
  setAgentRate(
    @Param('id') id: string,
    @Body() dto: SetAgentRateDto,
    @Req() req: any,
  ) {
    return this.agents.setRate(id, dto.ratePercent ?? null, this.actor(req));
  }

  // PR-AGENT-PORTAL phase 1 — mark an agent as under contract without one.
  // OWNER only (the service re-checks), reason required, audited as its own
  // event. A stand-in until the DocuSeal agent-contract flow ships.
  @Patch('agents/:id/clear-contract')
  @Roles('OWNER')
  clearAgentContract(
    @Param('id') id: string,
    @Body() dto: ClearAgentContractDto,
    @Req() req: any,
  ) {
    return this.agents.clearContract(id, dto.reason, this.actor(req));
  }

  @Delete('agents/:id')
  @Roles('OWNER')
  deleteAgent(@Param('id') id: string, @Req() req: any) {
    return this.agents.delete(id, this.actor(req));
  }

  // ─── Tracking links ──────────────────────────────────────────────

  @Get('links')
  listLinks(
    @Query('channel') channel?: MarketingChannelType,
    @Query('agentId') agentId?: string,
    @Query('status')  status?: TrackingLinkStatus,
    @Query('search')  search?: string,
  ) {
    return this.links.list({ channel, agentId, status, search });
  }

  @Get('links/:id')
  getLink(@Param('id') id: string) {
    return this.links.get(id);
  }

  @Post('links')
  createLink(@Body() dto: CreateTrackingLinkDto, @Req() req: any) {
    return this.links.create(dto, this.actor(req));
  }

  @Patch('links/:id/archive')
  archiveLink(@Param('id') id: string, @Req() req: any) {
    return this.links.archive(id, this.actor(req));
  }

  @Get('links/:id/stats')
  getStats(
    @Param('id') id: string,
    @Query('windowDays') windowDays?: string,
  ) {
    const days = windowDays ? Math.max(1, parseInt(windowDays, 10) || 30) : 30;
    return this.links.getStats(id, days);
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private actor(req: any) {
    return {
      // d95640d: JwtStrategy.validate returns { userId, ... }.
      userId: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? '',
    };
  }
}
