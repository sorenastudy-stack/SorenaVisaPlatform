import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getEngagementGateState, resolveOwnCaseId } from '../engagement-payment.helper';

// Piece #4 — portal payment gate (guard form).
//
// Locks a client's protected application surfaces (visa application form,
// admission application) until their engagement fee is PAID. Resolves the
// caller's OWN case from the JWT (lead.contact.userId → case) and checks the
// ENG invoice — never trusts a client-supplied id.
//
// Apply AFTER JwtAuthGuard (which populates req.user) and the role guard, e.g.
//   @UseGuards(JwtAuthGuard, RolesGuard, EngagementPaidGuard)
//
// FAIL SAFE: no case, no engagement invoice, or any error → LOCKED (403). We
// never silently unlock. This gates CLIENTS only — it's mounted on the
// STUDENT/AGENT self-service controllers, so staff routes are never touched.
@Injectable()
export class EngagementPaidGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId ?? req.user?.id;

    const caseId = await resolveOwnCaseId(this.prisma, userId);
    const { paid } = await getEngagementGateState(this.prisma, caseId);
    if (!paid) {
      throw new ForbiddenException(this.message(req.user?.role));
    }
    return true;
  }

  /**
   * What to say to the person actually reading it.
   *
   * These controllers are mounted for STUDENT *and* AGENT. The original wording
   * — "once we confirm your payment" — is right for a client and meaningless to
   * an agent, who has no engagement fee and never will: they reached a client
   * surface that was never meant for them. Telling somebody to wait for a
   * payment they cannot make sends them to support with a question nobody can
   * answer.
   *
   * The distinction is cosmetic to the boundary — both answers are the same
   * refusal — but a refusal is still something a person has to act on.
   */
  private message(role: unknown): string {
    if (role === 'AGENT') {
      return 'This is a client area. Your agent dashboard is at /agent.';
    }
    return 'Your full access opens once we confirm your payment.';
  }
}
