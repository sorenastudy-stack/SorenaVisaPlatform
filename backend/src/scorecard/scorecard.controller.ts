import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ScorecardService } from './scorecard.service';
import {
  SaveScorecardDraftDto,
  SubmitScorecardDto,
} from './dto/scorecard.dto';
import { shortFilenameSlug } from './pdf';

// PR-SCORECARD-1 — Readiness Assessment endpoints.
//
// Five routes, three role tiers:
//   - submit / me/* : LEAD, STUDENT, OWNER, ADMIN, SUPER_ADMIN
//   - /staff/scorecard/:id : OWNER, ADMIN, SUPER_ADMIN, CONSULTANT
//   - booking-opened : LEAD, STUDENT only (own submission)
//
// All routes use req.user?.userId ?? req.user?.id per d95640d.

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScorecardController {
  constructor(private readonly service: ScorecardService) {}

  // POST /scorecard/submit
  @Post('scorecard/submit')
  @Roles('LEAD', 'STUDENT', 'OWNER', 'ADMIN', 'SUPER_ADMIN')
  submit(@Body() dto: SubmitScorecardDto, @Req() req: any) {
    const actor = this.viewer(req);
    return this.service.submitScorecard(
      actor.userId,
      dto.answers,
      {
        ipAddress: this.extractIp(req),
        userAgent: this.extractUserAgent(req),
      },
      actor,
      // PR-SCORECARD-2: forward attribution from the body. The client
      // populates this from the sv_attribution cookie + URL params.
      dto.attribution ?? {},
    );
  }

  // POST /scorecard/draft — PR-SCORECARD-2 autosave.
  @Post('scorecard/draft')
  @Roles('LEAD', 'STUDENT', 'OWNER', 'ADMIN', 'SUPER_ADMIN')
  saveDraft(@Body() dto: SaveScorecardDraftDto, @Req() req: any) {
    const actor = this.viewer(req);
    return this.service.saveDraft(actor.userId, dto.answers);
  }

  // GET /scorecard/me/draft — PR-SCORECARD-2 draft retrieval. Returns
  // 200 with `null` body when no draft exists, so the form's loader
  // can render an empty state without a 404 round-trip.
  @Get('scorecard/me/draft')
  @Roles('LEAD', 'STUDENT', 'OWNER', 'ADMIN', 'SUPER_ADMIN')
  myDraft(@Req() req: any) {
    const actor = this.viewer(req);
    return this.service.getDraft(actor.userId);
  }

  // GET /scorecard/me/latest
  @Get('scorecard/me/latest')
  @Roles('LEAD', 'STUDENT', 'OWNER', 'ADMIN', 'SUPER_ADMIN')
  myLatest(@Req() req: any) {
    const actor = this.viewer(req);
    return this.service.getMyLatestResult(actor.userId);
  }

  // GET /scorecard/me/history
  @Get('scorecard/me/history')
  @Roles('LEAD', 'STUDENT', 'OWNER', 'ADMIN', 'SUPER_ADMIN')
  myHistory(@Req() req: any) {
    const actor = this.viewer(req);
    return this.service.getMyHistory(actor.userId);
  }

  // GET /staff/scorecards (list)
  @Get('staff/scorecards')
  @Roles('OWNER', 'ADMIN', 'SUPER_ADMIN', 'CONSULTANT')
  staffList(@Req() req: any) {
    return this.service.listForStaff(this.viewer(req));
  }

  // GET /staff/scorecard/:submissionId (detail)
  @Get('staff/scorecard/:submissionId')
  @Roles('OWNER', 'ADMIN', 'SUPER_ADMIN', 'CONSULTANT')
  staffDetail(@Param('submissionId') submissionId: string, @Req() req: any) {
    return this.service.getSubmissionByIdForStaff(submissionId, this.viewer(req));
  }

  // POST /scorecard/:submissionId/booking-opened
  @Post('scorecard/:submissionId/booking-opened')
  @Roles('LEAD', 'STUDENT')
  bookingOpened(@Param('submissionId') submissionId: string, @Req() req: any) {
    const actor = this.viewer(req);
    return this.service.recordBookingLinkOpened(submissionId, actor.userId);
  }

  // PR-SCORECARD-3: GET /scorecard/:submissionId/pdf — client-facing
  // PDF report. The applicant downloads their own; staff can download
  // any submission's client report (so they can preview / forward it).
  @Get('scorecard/:submissionId/pdf')
  @Roles('LEAD', 'STUDENT', 'OWNER', 'ADMIN', 'SUPER_ADMIN', 'CONSULTANT')
  async clientPdf(
    @Param('submissionId') submissionId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const actor = this.viewer(req);
    const { buffer, applicantName, submittedAt } = await this.service.generateClientPdf(
      submissionId, actor,
    );
    const filename = pdfFilename('sorena-assessment', applicantName, submittedAt);
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Length', buffer.length)
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  }

  // PR-SCORECARD-3: GET /staff/scorecard/:submissionId/pdf — internal
  // staff PDF (the long one with hard-stop codes, gate logic, full
  // answer log). Audit row written on every download.
  @Get('staff/scorecard/:submissionId/pdf')
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT')
  async staffPdf(
    @Param('submissionId') submissionId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const actor = this.viewer(req);
    const { buffer, applicantName, submittedAt } = await this.service.generateInternalPdf(
      submissionId, actor,
    );
    const filename = pdfFilename('sorena-internal', applicantName, submittedAt);
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Length', buffer.length)
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  }

  private viewer(req: any) {
    return {
      // PR-LIA-d95640d: JwtStrategy.validate returns { userId, ... }.
      userId: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? '',
    };
  }

  private extractIp(req: any): string | null {
    const fwd = req.headers?.['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
    return req.ip ?? req.connection?.remoteAddress ?? null;
  }

  private extractUserAgent(req: any): string | null {
    const ua = req.headers?.['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }
}

// PR-SCORECARD-3 — Compose a download filename like
// `sorena-assessment-yashua-a-20260528.pdf`. The slug-builder
// handles unicode + non-ASCII names (falling back to "applicant"
// when nothing convertible remains), so the result is always safe
// on Windows, macOS, and Linux filesystems.
function pdfFilename(prefix: string, applicantName: string, submittedAt: Date): string {
  const slug = shortFilenameSlug(applicantName);
  const yyyymmdd = submittedAt.toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${slug}-${yyyymmdd}.pdf`;
}
