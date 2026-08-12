import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  AgentPayablesService,
  PAYABLE_APPROVE_ROLES,
  PAYABLE_RELEASE_ROLES,
  PAYABLE_VIEW_ROLES,
} from './agent-payables.service';
import { RejectPayableDto } from './dto/reject-payable.dto';

// PR-AGENT-PAYABLES — the ledger (phase 1) and the decisions on it (phase 2).
//
// Reading is the same money tier as the commission ledger these payables are
// derived from: if you can see what a provider owes Sorena, you can see what
// Sorena owes the agent who introduced the client.
//
// Deciding is narrower, and split. FINANCE approves or refuses; only the OWNER
// releases. The role gate here says who may ask — the service enforces the rule
// that actually matters, which is that the approver and the releaser are not
// the same person.
@Controller('staff/agent-payables')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgentPayablesController {
  constructor(private readonly payables: AgentPayablesService) {}

  private actor(req: any) {
    return {
      id: req.user?.userId ?? req.user?.id ?? null,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
      secondaryRoles: req.user?.secondaryRoles ?? [],
    };
  }

  @Get()
  @Roles(...PAYABLE_VIEW_ROLES)
  list(@Req() req: any) {
    return this.payables.list(this.actor(req));
  }

  @Get('summary')
  @Roles(...PAYABLE_VIEW_ROLES)
  summary(@Req() req: any) {
    return this.payables.summary(this.actor(req));
  }

  /** Finance's queue: shares waiting to be agreed. */
  @Get('pending')
  @Roles(...PAYABLE_APPROVE_ROLES)
  pending(@Req() req: any) {
    return this.payables.listPending(this.actor(req));
  }

  /** The Owner's queue: agreed shares waiting to be released. */
  @Get('awaiting-release')
  @Roles(...PAYABLE_VIEW_ROLES)
  awaitingRelease(@Req() req: any) {
    return this.payables.listAwaitingRelease(this.actor(req));
  }

  /** The badge. Cheap enough to sit in the nav on every page load. */
  @Get('awaiting-release/count')
  @Roles(...PAYABLE_VIEW_ROLES)
  awaitingReleaseCount(@Req() req: any) {
    return this.payables.awaitingReleaseCount(this.actor(req));
  }

  @Patch(':id/approve')
  @Roles(...PAYABLE_APPROVE_ROLES)
  approve(@Param('id') id: string, @Req() req: any) {
    return this.payables.approve(id, this.actor(req));
  }

  @Patch(':id/reject')
  @Roles(...PAYABLE_APPROVE_ROLES)
  reject(@Param('id') id: string, @Body() dto: RejectPayableDto, @Req() req: any) {
    return this.payables.reject(id, dto.reason, this.actor(req));
  }

  @Patch(':id/release')
  @Roles(...PAYABLE_RELEASE_ROLES)
  release(@Param('id') id: string, @Req() req: any) {
    return this.payables.release(id, this.actor(req));
  }
}
