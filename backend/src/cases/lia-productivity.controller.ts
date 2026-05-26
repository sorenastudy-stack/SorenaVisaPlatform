import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { LiaProductivityService } from './lia-productivity.service';

// PR-LIA-3 — Productivity report endpoints.
//
// Strict OWNER / ADMIN / SUPER_ADMIN gate — LIA users do NOT see
// peer-comparison metrics. The `getMyStats` service method ships
// for a future self-view widget (PR-LIA-3.1), but no LIA-facing
// route is exposed in this PR.

@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')
export class LiaProductivityController {
  constructor(private readonly productivity: LiaProductivityService) {}

  @Get('lia-productivity')
  list() {
    return this.productivity.getRoster();
  }

  @Get('lia-productivity/:liaId')
  detail(@Param('liaId') liaId: string) {
    return this.productivity.getMyStats(liaId);
  }
}
