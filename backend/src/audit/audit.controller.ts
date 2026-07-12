import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';

// OWNER audit-log browser. Tightly gated: OWNER + SUPER_ADMIN only — ADMIN is
// deliberately excluded (they reach the admin portal but 403 here). The audit
// log records sensitive access history (who viewed which document, refunds,
// INZ-data access, staff-reassignment reasons), so it sits above ADMIN.
//
//   GET /admin/audit      — paginated LIST, safe summaries, NO old/new values.
//   GET /admin/audit/:id  — single-row DETAIL, INCLUDING raw old/new values.
// Read-only: no POST/PATCH/DELETE routes exist.
@Controller('admin/audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  list(@Query() query: AuditQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }
}
