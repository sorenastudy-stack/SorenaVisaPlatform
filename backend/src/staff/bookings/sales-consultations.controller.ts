import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { StaffBookingsService } from './staff-bookings.service';

// PR-SALES-CONSULTATIONS — GET /staff/consultations
//
// The consultations belonging to a lead the caller owns. A separate controller
// from StaffBookingsController next door, and deliberately so: that one is
// guarded by StaffRolesGuard, whose StaffAccessRole union does not include SALES
// — because SALES is not a /staff-portal role, it lives at /sales. Widening that
// union to reach this one endpoint would have made a salesperson a staff-portal
// user everywhere the guard is applied.
//
// So this uses the ordinary @Roles/RolesGuard pair, which is exactly what the
// two surfaces this mirrors — /leads and /commissions — already use.
//
// Scoping lives in the service, not here: the role gate says who may ask, the
// service decides what they get back.
const VIEW_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'FINANCE', 'SALES', 'CONSULTANT'] as const;

@Controller('staff/consultations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesConsultationsController {
  constructor(private readonly bookings: StaffBookingsService) {}

  @Get()
  @Roles(...VIEW_ROLES)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  list(@Req() req: any) {
    return this.bookings.listForOwnedLeads({
      userId: req.user?.userId ?? req.user?.id ?? null,
      role: req.user?.role ?? null,
      secondaryRoles: req.user?.secondaryRoles ?? [],
    });
  }
}
