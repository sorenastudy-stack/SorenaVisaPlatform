import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ScorecardService } from './scorecard.service';
import { SubmitScorecardDto } from './dto/scorecard.dto';

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
    );
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
