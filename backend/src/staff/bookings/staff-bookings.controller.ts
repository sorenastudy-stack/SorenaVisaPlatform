import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { StaffRoles } from '../roles/staff-roles.decorator';
import { BookingCancellationService } from '../../booking/booking-cancellation.service';
import { StaffBookingsService } from './staff-bookings.service';
import { MarkConsultationStatusDto } from './dto/staff-bookings.dto';

// PR-WALLET slice 2 — staff consultation-bookings surface.
//
// Open to the roles that run consultations (LIA/CONSULTANT) plus admin tier;
// the marker itself further requires the caller to be the ASSIGNED consultant
// or an admin (enforced in BookingCancellationService). NO_SHOW on a paid
// booking posts the 75% wallet credit; COMPLETED posts nothing; CANCELLED uses
// the same time-based tier as a client cancel — all atomic with the status flip.
const STAFF = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT'] as const;

@Controller('staff')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class StaffBookingsController {
  constructor(
    private readonly bookings: StaffBookingsService,
    private readonly cancellation: BookingCancellationService,
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
}
