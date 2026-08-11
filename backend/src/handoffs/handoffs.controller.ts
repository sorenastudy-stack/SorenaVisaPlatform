import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { HandoffsService } from './handoffs.service';
import { OpsHandoffsService } from '../ops-handoffs/ops-handoffs.service';

// PR-HANDOFFS — Owner-dashboard Handoffs section. OWNER / SUPER_ADMIN only, the
// same oversight tier as /admin/audit and the Compliance section.
//
// PR-OPS-RETIRE — /ops/handoffs/pending moved here. That route was gated to
// OPERATIONS, a role with no users, and no frontend called it; the list itself
// is worth keeping, so it survives at this address under this page's gate.
// The stuck-case detection behind getHandoffs() is untouched.
@Controller('api/staff/handoffs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN')
export class HandoffsController {
  constructor(
    private readonly service: HandoffsService,
    private readonly opsHandoffs: OpsHandoffsService,
  ) {}

  // GET /api/staff/handoffs — staffing exceptions + stuck cases in one payload.
  @Get()
  getHandoffs() {
    return this.service.getHandoffs();
  }

  // Cases with a due-but-empty specialist slot. Same service as the retired
  // /ops/handoffs/pending — only the route and gate moved.
  @Get('pending')
  pending() {
    return this.opsHandoffs.listPendingHandoffs();
  }
}
