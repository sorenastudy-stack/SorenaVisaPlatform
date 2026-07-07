import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
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

  // GET /portal/me/stage → { portalStage: 'STAGE_1' | 'STAGE_2' }
  // Stage-gate value for the client portal. STAGE_2 once the client (or their
  // guardian) AND the LIA have signed the contract (director ignored). Derived
  // server-side from the caller's own case — never throws, never 404s.
  @Get('me/stage')
  getPortalStage(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.getPortalStage(userId);
  }

  // GET /portal/me/payments → the caller's OWN payment history (read-only).
  @Get('me/payments')
  getMyPayments(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.getMyPayments(userId);
  }

  // GET /portal/me/invoices/:invoiceId/pay-options → read-only pay-screen data
  // (base amount, card total incl. server-derived surcharge, currency, client
  // name). Ownership from the JWT; a foreign invoice returns the same 404.
  @Get('me/invoices/:invoiceId/pay-options')
  getInvoicePayOptions(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.getInvoicePayOptions(userId, invoiceId);
  }

  // POST /portal/me/invoices/:invoiceId/pay-link → { url }
  // Generates a Stripe pay link for the caller's OWN unpaid invoice. The
  // amount is read server-side from the Invoice; the client only supplies
  // invoiceId, which the service re-verifies belongs to the caller's own
  // case (never trusting a client-supplied case id).
  @Post('me/invoices/:invoiceId/pay-link')
  payInvoice(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.createInvoicePayLink(userId, invoiceId);
  }
}
