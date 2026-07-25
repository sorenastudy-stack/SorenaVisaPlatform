import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { HandoffsService } from './handoffs.service';

// PR-HANDOFFS — Owner-dashboard Handoffs section. OWNER / SUPER_ADMIN only, the
// same oversight tier as /admin/audit and the Compliance section. (The legacy
// /ops/handoffs surface stays for OPERATIONS; this is its Owner-dashboard
// counterpart, cross-case and read-only.)
@Controller('api/staff/handoffs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN')
export class HandoffsController {
  constructor(private readonly service: HandoffsService) {}

  // GET /api/staff/handoffs — staffing exceptions + stuck cases in one payload.
  @Get()
  getHandoffs() {
    return this.service.getHandoffs();
  }
}
