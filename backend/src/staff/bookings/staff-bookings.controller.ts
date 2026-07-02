import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { StaffRoles } from '../roles/staff-roles.decorator';
import { BookingCancellationService } from '../../booking/booking-cancellation.service';
import { RefundService } from '../../payments/refund.service';
import { OwnerApprovalService } from '../owner-approval/owner-approval.service';
import { StaffBookingsService } from './staff-bookings.service';
import { MarkConsultationStatusDto, RefundToCardDto } from './dto/staff-bookings.dto';

// PR-WALLET slice 2 — staff consultation-bookings surface.
//
// Open to the roles that run consultations (LIA/CONSULTANT) plus admin tier;
// the marker itself further requires the caller to be the ASSIGNED consultant
// or an admin (enforced in BookingCancellationService). NO_SHOW on a paid
// booking posts the 75% wallet credit; COMPLETED posts nothing; CANCELLED uses
// the same time-based tier as a client cancel — all atomic with the status flip.
const STAFF = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT'] as const;
// PR-CARD-REFUND — real money out. Admin tier ONLY, never a regular consultant.
const ADMIN_TIER = ['OWNER', 'SUPER_ADMIN', 'ADMIN'] as const;

@Controller('staff')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class StaffBookingsController {
  constructor(
    private readonly bookings: StaffBookingsService,
    private readonly cancellation: BookingCancellationService,
    private readonly refunds: RefundService,
    private readonly approvals: OwnerApprovalService,
  ) {}

  // GET /staff/bookings — consultations (admin: all; consultant: assigned).
  @Get('bookings')
  @StaffRoles(...STAFF)
  list(@Req() req: any) {
    return this.bookings.list({ userId: req.user.userId, role: req.user.role });
  }

  // PATCH /staff/consultations/:id/status { NO_SHOW | COMPLETED | CANCELLED }
  @Patch('consultations/:id/status')
  @StaffRoles(...STAFF)
  markStatus(@Param('id') id: string, @Body() dto: MarkConsultationStatusDto, @Req() req: any) {
    return this.cancellation.staffMarkStatus(
      id, { userId: req.user.userId, role: req.user.role }, dto.status,
    );
  }

  // GET /staff/consultations/:id/refund-preview
  // PR-CARD-REFUND — read-only display data for the owner-approval card
  // (client, booking, full captured amount, refundable heads-up). Admin tier.
  @Get('consultations/:id/refund-preview')
  @StaffRoles(...ADMIN_TIER)
  refundPreview(@Param('id') id: string) {
    return this.bookings.refundPreview(id);
  }

  // POST /staff/consultations/:id/refund-to-card { reason? }
  // PR-CARD-REFUND (two-person control) — this does NOT move money. It only
  // ENQUEUES an ISSUE_REFUND request for OWNER approval. The real Stripe refund
  // happens only when a *different* OWNER approves it (owner-approval flow).
  // ADMIN TIER may request; the request-time pre-check gives immediate feedback
  // (no card payment / already wallet-credited / already refunded).
  @Post('consultations/:id/refund-to-card')
  @StaffRoles(...ADMIN_TIER)
  async refundToCard(@Param('id') id: string, @Body() dto: RefundToCardDto, @Req() req: any) {
    await this.refunds.assertRefundable(id);
    const request = await this.approvals.requestApproval({
      requestedById: req.user.userId,
      actionType: 'ISSUE_REFUND',
      payload: { consultationId: id, reason: dto.reason ?? null },
      reason: dto.reason,
    });
    return { status: 'PENDING_OWNER_APPROVAL', requestId: request.id };
  }
}
