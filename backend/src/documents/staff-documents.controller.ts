import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../staff/roles/staff-roles.guard';
import { StaffRoles, STAFF_PORTAL_ROLES } from '../staff/roles/staff-roles.decorator';
import { DocumentsService } from './documents.service';

// PR-STAFF-DOCS — cross-case "My case documents" list.
//
// Assignment-based least-access: a staff member sees documents ONLY for cases
// they are CURRENTLY assigned to (any of the 4 Case slots), resolved live in
// DocumentsService.listMyDocuments — so a reassign-away drops the case on the
// next request. Admin tier sees all. Per-document DOWNLOAD reuses the existing
// GET /cases/:caseId/documents/:documentId/download-url, which independently
// re-checks current assignment server-side and audits every download.
@Controller('api/staff/documents')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class StaffDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @StaffRoles(...STAFF_PORTAL_ROLES)
  listMine(@Req() req: any) {
    return this.documents.listMyDocuments({
      id: req.user.userId,
      name: req.user.name ?? null,
      role: req.user.role ?? null,
    });
  }
}
