import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { InzDataService } from './inz-data.service';

// PR-LIA-6 — Consolidated INZ application data viewer (read-only).
//
// Every view writes an audit row (LIA_INZ_DATA_VIEWED). PII is
// surfaced in plaintext to the LIA — the audit log is the compliance
// trail for who accessed what and when.

@Controller('cases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
export class InzDataController {
  constructor(
    private readonly service: InzDataService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':caseId/inz-data')
  async get(@Param('caseId') caseId: string, @Req() req: any) {
    const payload = await this.service.getInzDataForCase(caseId);
    // Audit AFTER the service has resolved (so we don't log a viewing
    // event for a 404 caseId). Best-effort — a failed audit log
    // shouldn't fail the read.
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: req.user?.userId ?? req.user?.id ?? null,
          action: 'VIEW',
          eventType: 'LIA_INZ_DATA_VIEWED',
          entityType: 'CASE',
          entityId: caseId,
          newValue: { caseId } as Prisma.InputJsonValue,
          actorNameSnapshot: req.user?.name ?? null,
          actorRoleSnapshot: req.user?.role ?? null,
        },
      });
    } catch {
      /* swallow — read succeeds even if audit fails */
    }
    return payload;
  }

  // ── PR-FILES-1: LIA download endpoints for visa documents ─────────
  //
  // Class-level guards already enforce JwtAuthGuard + RolesGuard +
  // @Roles('LIA','ADMIN','SUPER_ADMIN','OWNER') (layer 2). The service
  // additionally verifies the doc belongs to the requested case — so
  // an LIA on case A can't pull a doc that lives on case B by
  // guessing ids; a mismatch returns 404 (not 403) to avoid leaking
  // doc existence. Signed-URL minting + audit live in the service
  // (layers 7 + 6).
  //
  // Two routes — one per kind — to keep ids unambiguous (a visa
  // supporting doc id and an other-evidence entry id are separate
  // tables and shouldn't share a single dispatcher path).

  @Get(':caseId/visa-documents/supporting/:docId/download-url')
  downloadSupportingDoc(
    @Param('caseId') caseId: string,
    @Param('docId') docId: string,
    @Req() req: any,
  ) {
    return this.service.createVisaSupportingDocDownloadUrl(
      caseId,
      docId,
      this.actor(req),
    );
  }

  @Get(':caseId/visa-documents/other-evidence/:entryId/download-url')
  downloadOtherEvidence(
    @Param('caseId') caseId: string,
    @Param('entryId') entryId: string,
    @Req() req: any,
  ) {
    return this.service.createVisaOtherEvidenceDownloadUrl(
      caseId,
      entryId,
      this.actor(req),
    );
  }

  private actor(req: any) {
    return {
      id: req.user?.userId ?? req.user?.id ?? null,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
