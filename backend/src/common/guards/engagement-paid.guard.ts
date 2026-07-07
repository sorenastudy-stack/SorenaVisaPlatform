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
      throw new ForbiddenException(
        'Your full access opens once we confirm your payment.',
      );
    }
    return true;
  }
}
