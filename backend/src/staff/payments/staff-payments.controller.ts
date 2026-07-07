import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { StaffRoles } from '../roles/staff-roles.decorator';
import { StaffPaymentsService } from './staff-payments.service';

// Piece #3 — accountant "confirm payments" surface.
//
// FINANCE (the accountant) + OWNER only. This is the staff counterpart to the
// Piece #2 client receipt upload: the client uploaded a receipt (invoice went
// to "processing"), the accountant checks the bank here and confirms, flipping
// the invoice SENT→PAID.
//
// Gate: `@StaffRoles('OWNER','FINANCE')` — enforced server-side by
// StaffRolesGuard against `req.user.role`. Every other staff role (ADMIN,
// SUPER_ADMIN, LIA, CONSULTANT, SUPPORT, OPERATIONS) and every client role is
// rejected with 403. This is ADDITIVE — no existing route or role is altered.
const CONFIRMERS = ['OWNER', 'FINANCE'] as const;

@Controller('staff/payments')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class StaffPaymentsController {
  constructor(private readonly service: StaffPaymentsService) {}

  // GET /staff/payments/pending-confirmation → invoices awaiting confirmation.
  @Get('pending-confirmation')
  @StaffRoles(...CONFIRMERS)
  listPending() {
    return this.service.listPendingConfirmation();
  }

  // GET /staff/payments/invoices/:invoiceId/receipt → signed URL to view it.
  @Get('invoices/:invoiceId/receipt')
  @StaffRoles(...CONFIRMERS)
  viewReceipt(@Param('invoiceId') invoiceId: string) {
    return this.service.getReceiptDownloadUrl(invoiceId);
  }

  // POST /staff/payments/invoices/:invoiceId/confirm → flip SENT→PAID.
  @Post('invoices/:invoiceId/confirm')
  @StaffRoles(...CONFIRMERS)
  confirm(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.confirmInvoicePayment(userId, invoiceId);
  }

  // POST /staff/payments/invoices/:invoiceId/reject { reason? } → clear the
  // receipt so the client can re-upload (does not touch money; status stays SENT).
  @Post('invoices/:invoiceId/reject')
  @StaffRoles(...CONFIRMERS)
  reject(
    @Param('invoiceId') invoiceId: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.rejectReceipt(userId, invoiceId, body?.reason);
  }
}
