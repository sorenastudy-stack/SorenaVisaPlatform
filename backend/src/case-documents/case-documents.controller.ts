import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CaseDocumentReviewSource } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CaseDocumentsService } from './case-documents.service';
import { ReviewDocumentDto } from './dto/case-documents.dto';

// PR-LIA-5 — Unified document surface for the LIA portal.
//
// /cases/:caseId/documents                                 — list across sources
// /cases/:caseId/documents/:source/:sourceRowId/download-url — signed URL
// /cases/:caseId/documents/:source/:sourceRowId/review     — upsert verdict
// /cases/:caseId/documents/:source/:sourceRowId/review (DELETE) — clear verdict

@Controller('cases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OPERATIONS', 'LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
export class CaseDocumentsController {
  constructor(private readonly service: CaseDocumentsService) {}

  // Renamed from ':caseId/documents' to avoid the route collision with the
  // System-A R2 documents controller (DocumentsController @Controller('cases')),
  // which was shadowing this list. Now a distinct path.
  // Phase 5d — CONSULTANT (Admission Specialist) is granted READ access here
  // (this route + download-url below only), then filtered to Priority-1 docs in
  // the service. The per-route @Roles OVERRIDES the class-level list (RolesGuard
  // uses getAllAndOverride), so CONSULTANT is NOT admitted to the review/verdict
  // routes below — they keep the class @Roles and 403 a CONSULTANT (view-only).
  @Get(':caseId/document-reviews')
  @Roles('OPERATIONS', 'LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER', 'CONSULTANT')
  list(@Param('caseId') caseId: string, @Req() req: any) {
    // Pass the VERIFIED JWT role so OPS never sees VISA_SUPPORTING (legal) docs
    // and CONSULTANT sees Priority-1 only.
    return this.service.listAllDocumentsForCase(caseId, this.actor(req).role);
  }

  @Get(':caseId/documents/:source/:sourceRowId/download-url')
  @Roles('OPERATIONS', 'LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER', 'CONSULTANT')
  download(
    @Param('caseId') caseId: string,
    @Param('source') source: string,
    @Param('sourceRowId') sourceRowId: string,
    @Req() req: any,
  ) {
    return this.service.createDownloadUrl(
      caseId,
      this.parseSource(source),
      sourceRowId,
      this.actor(req),
    );
  }

  @Post(':caseId/documents/:source/:sourceRowId/review')
  review(
    @Param('caseId') caseId: string,
    @Param('source') source: string,
    @Param('sourceRowId') sourceRowId: string,
    @Body() dto: ReviewDocumentDto,
    @Req() req: any,
  ) {
    return this.service.upsertReview(
      caseId,
      this.parseSource(source),
      sourceRowId,
      dto,
      this.actor(req),
    );
  }

  @Delete(':caseId/documents/:source/:sourceRowId/review')
  clearReview(
    @Param('caseId') caseId: string,
    @Param('source') source: string,
    @Param('sourceRowId') sourceRowId: string,
    @Req() req: any,
  ) {
    return this.service.clearReview(
      caseId,
      this.parseSource(source),
      sourceRowId,
      this.actor(req),
    );
  }

  private parseSource(s: string): CaseDocumentReviewSource {
    if (s === 'ADMISSION' || s === 'APPLICATION' || s === 'VISA_SUPPORTING') {
      return s;
    }
    throw new BadRequestException(`Unknown document source: ${s}`);
  }

  private actor(req: any) {
    return {
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
