import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CaseDocumentsService } from './case-documents.service';

// OPS cross-case document review queue. Non-colliding path (/ops/documents),
// separate from the per-case /cases/:caseId/documents routes. Cross-case read
// is allowed ONLY for OPERATIONS + admin tier — enforced server-side here.
@Controller('ops/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OPERATIONS', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
export class OpsDocumentsController {
  constructor(private readonly service: CaseDocumentsService) {}

  // GET /ops/documents/unreviewed — every unreviewed document across active cases.
  @Get('unreviewed')
  unreviewed() {
    return this.service.listUnreviewedAcrossCases();
  }
}
