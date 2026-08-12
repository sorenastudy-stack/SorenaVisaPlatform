import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AgentPayablesService, PAYABLE_VIEW_ROLES } from './agent-payables.service';

// PR-AGENT-PAYABLES (phase 1) — read only.
//
// Same money tier as the commission ledger these payables are derived from: if
// you can see what a provider owes Sorena, you can see what Sorena owes the
// agent who introduced the client. Approve and pay arrive in phase 2 and are
// gated more tightly than this — FINANCE approves, OWNER releases.
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
}
