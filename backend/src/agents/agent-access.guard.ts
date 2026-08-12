import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveAgentAccess } from './agent-access.helper';

// PR-AGENT-PORTAL phase 1 — the gate, as a guard.
//
// Same shape as EngagementPaidGuard, which locks a client's application
// surfaces until their engagement fee clears: resolve the caller's OWN record
// from the JWT, check the condition, fail closed.
//
// Apply AFTER JwtAuthGuard and RolesGuard:
//   @UseGuards(JwtAuthGuard, RolesGuard, AgentAccessGuard)
//
// NOT applied to the status route. An agent who cannot get in still has to be
// told why, and a guard that blocks the explanation leaves them staring at a
// 403 with nowhere to go.
@Injectable()
export class AgentAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId ?? req.user?.id;

    const access = await resolveAgentAccess(this.prisma, userId);
    if (!access.allowed) {
      // Deliberately vague, and deliberately the same message whatever the
      // reason. The detail belongs to GET /agent/me, which the agent's own
      // screen reads; an error string is the wrong place to enumerate what a
      // caller has not satisfied.
      throw new ForbiddenException(
        'Your agent account is not active yet. Check your dashboard for what is outstanding.',
      );
    }

    // Hand the resolved agent to the service layer so it cannot re-derive it
    // differently — the ownership filter downstream depends on this being the
    // same agent the gate just approved.
    req.agentAccess = access;
    return true;
  }
}
