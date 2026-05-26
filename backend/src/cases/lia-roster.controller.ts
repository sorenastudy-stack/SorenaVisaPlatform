import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { LiaAssignmentService } from './lia-assignment.service';

// PR-LIA-2 — GET /staff/lia-roster. LIAs themselves can see the
// roster (transparency on who is busy); OWNER / ADMIN / SUPER_ADMIN
// also need it for the manual-reassign dropdown.
//
// The reason the route lives at /staff/lia-roster (not /cases/...) is
// that it is a staff-directory listing, not a case-scoped action.
// Sibling controller in the cases module to keep the workload-count
// logic next to the service that owns the auto-assignment rules.

@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
export class LiaRosterController {
  constructor(private readonly assignments: LiaAssignmentService) {}

  @Get('lia-roster')
  roster() {
    return this.assignments.getRoster();
  }
}
