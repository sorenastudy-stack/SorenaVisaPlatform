import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { StaffRoles } from '../roles/staff-roles.decorator';
import { StaffPaymentsService } from './staff-payments.service';

// Finance portal — read-only overview + confirmed-payments ledger.
//
// FINANCE (the accountant) + OWNER only, enforced server-side by
// StaffRolesGuard against req.user.role. Every other staff role and every
// client is 403. Additive — no existing route or role is altered.
const CONFIRMERS = ['OWNER', 'FINANCE'] as const;

@Controller('staff/finance')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class StaffFinanceController {
  constructor(private readonly service: StaffPaymentsService) {}

  // GET /staff/finance/dashboard → { pendingCount, confirmedThisWeek, confirmedAllTime }
  @Get('dashboard')
  @StaffRoles(...CONFIRMERS)
  dashboard() {
    return this.service.financeDashboard();
  }

  // GET /staff/finance/finalised → confirmed-payments ledger.
  @Get('finalised')
  @StaffRoles(...CONFIRMERS)
  finalised() {
    return this.service.listFinalised();
  }
}
