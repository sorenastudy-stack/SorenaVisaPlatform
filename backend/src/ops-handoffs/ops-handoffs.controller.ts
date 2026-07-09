import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OpsHandoffsService } from './ops-handoffs.service';

// Phase 6 — OPS Handoffs exceptions monitor. Cross-case read allowed ONLY for
// OPERATIONS + admin tier (the SEE_ALL tier), enforced server-side here — same
// gate as the OPS Documents queue. Read-only: OPS holds no assignment power
// (the reassign endpoints stay admin-only); each row links to the case for an
// admin to staff it.
@Controller('ops/handoffs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OPERATIONS', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
export class OpsHandoffsController {
  constructor(private readonly service: OpsHandoffsService) {}

  // GET /ops/handoffs/pending — cases with a due-but-empty specialist slot.
  @Get('pending')
  pending() {
    return this.service.listPendingHandoffs();
  }
}
