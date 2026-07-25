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
@Controller('api/staff/case-documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'CLIENT_CONSULTANT')
export class StaffCaseDocumentsController {
  constructor(private readonly service: CaseDocumentsService) {}

  @Get()
  listAll(@Req() req: any) {
    return this.service.listAllDocumentsAcrossCases({
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    });
  }
}
