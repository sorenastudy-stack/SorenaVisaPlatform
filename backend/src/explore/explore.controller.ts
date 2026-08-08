import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { EngagementPaidGuard } from '../common/guards/engagement-paid.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ExploreService } from './explore.service';
import { ExploreQueryDto } from './dto/explore-query.dto';

// PR-EXPLORE — student-facing programme map.
//
// STUDENT only, matching how /student/* is gated in the frontend and how the
// recommendations endpoints are gated here. Every response is scoped to the
// AUTHENTICATED student: their nationality decides the tuition rate and which
// scholarships apply, so no user id is ever accepted from the client.
//
// PR-PHASE38 — EngagementPaidGuard added. The sidebar had shown a lock on
// Explore since 6675de1, but nothing enforced it: an unpaid student who clicked
// through (or typed the URL) got the full catalogue. The same guard the
// recommendations, admission and visa controllers already use now sits here, so
// the lock is real on the server and not just an icon. Mounted at the CONTROLLER
// level, so it covers the list, the programme detail, its videos and its
// change feed in one place — a per-route decorator would be one @Get away from
// leaking again.
@Controller('explore')
@UseGuards(JwtAuthGuard, RolesGuard, EngagementPaidGuard)
@Roles('STUDENT')
export class ExploreController {
  constructor(private readonly explore: ExploreService) {}

  @Get()
  list(@Query() query: ExploreQueryDto, @Req() req: any) {
    return this.explore.list(req.user?.userId, {
      sort: query.sort,
      search: query.search,
      level: query.level,
      maxTuitionNZD: query.maxTuitionNZD,
    });
  }

  @Get('programmes/:programmeId')
  detail(@Param('programmeId') programmeId: string, @Req() req: any) {
    return this.explore.detail(req.user?.userId, programmeId);
  }

  // Loaded separately by the detail page — see the comment on videos().
  @Get('programmes/:programmeId/videos')
  videos(@Param('programmeId') programmeId: string) {
    return this.explore.videos(programmeId);
  }

  // `since` is the student's own last-viewed timestamp, held client-side. An
  // unparseable value is treated as "no history yet" rather than rejected —
  // this is a nicety on the page, not something worth failing it for.
  @Get('programmes/:programmeId/changes')
  changes(@Param('programmeId') programmeId: string, @Query('since') since?: string) {
    const parsed = since ? new Date(since) : null;
    return this.explore.changesSince(
      programmeId,
      parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
    );
  }
}
