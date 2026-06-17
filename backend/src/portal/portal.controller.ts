import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PortalService } from './portal.service';

// Client portal step 2 — client-only routes.
//
// Class-level guards:
//   • JwtAuthGuard — every route requires a valid signed-in user.
//   • RolesGuard + @Roles('LEAD', 'STUDENT') — only client roles. The
//     same gate pattern other modules use (e.g. students/* controller).
//     A staff role token (OWNER/ADMIN/SUPER_ADMIN/LIA/CONSULTANT/
//     SUPPORT/FINANCE/SALES/OPERATIONS) is rejected with 403.
//
// Note: no route takes a case id. The case is derived from the JWT's
// userId via the (lead.contact.userId) chain in the service — see
// PortalService for the security reasoning.

@Controller('portal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LEAD', 'STUDENT')
export class PortalController {
  constructor(private readonly service: PortalService) {}

  @Get('me/case')
  getMyCase(@Req() req: any) {
    // Mirrors the actor-id pattern used throughout the codebase
    // (req.user?.userId ?? req.user?.id) — JwtStrategy returns
    // { userId, email, role } so the first branch always wins, but
    // the fallback is kept for parity with neighbours.
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.getMyCase(userId);
  }
}
