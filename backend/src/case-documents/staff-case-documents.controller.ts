import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CaseDocumentsService } from './case-documents.service';

// PR-OWNER-DOCS — Owner-dashboard cross-case document list.
//
// GET /api/staff/case-documents → every document the caller may see, across every
// case they may see. The service (listAllDocumentsAcrossCases) applies BOTH the
// case scoping (read-all roles → all cases; others → assigned cases) AND the
// per-document visibility rule (canRoleViewDocument) — the SAME rule the per-case
// list + download gate use. This controller only role-gates who may CALL it; the
// service enforces what each role actually sees.
//
// SUPPORT and FINANCE are here because the scoping already accounts for them:
// resolveScopedCaseIds matches on supportId and financeId alongside the other
// staff slots, so each sees documents for the cases they hold a slot on and
// nothing else. Leaving them off the decorator meant /staff/documents — which
// admits both roles — 403'd for them: a page they could open and not use.
@Controller('api/staff/case-documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  'OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA',
  'CONSULTANT', 'CLIENT_CONSULTANT', 'SUPPORT', 'FINANCE',
)
export class StaffCaseDocumentsController {
  constructor(private readonly service: CaseDocumentsService) {}

  // PR-OPS-RETIRE — every unreviewed document across active cases, moved from
  // /ops/documents/unreviewed. That route was gated to OPERATIONS (no users) and
  // no frontend ever called it. The queue is worth keeping, so it lives here
  // under the oversight tier instead of being deleted with the route.
  //
  // Declared BEFORE the bare @Get() so 'unreviewed' is not swallowed by it.
  @Get('unreviewed')
  @Roles('OWNER', 'SUPER_ADMIN')
  unreviewed() {
    return this.service.listUnreviewedAcrossCases();
  }

  @Get()
  listAll(@Req() req: any) {
    return this.service.listAllDocumentsAcrossCases({
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    });
  }
}
