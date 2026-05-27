import {
  Controller, Get, Param, Req, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { TrackingLinksService } from './tracking-links.service';

// PR-SCORECARD-2 — Public short-link redirector.
//
// `GET /s/:shortCode` — open to the world (no JwtAuthGuard, no RolesGuard).
//
// Flow:
//   1. Look up the TrackingLink by shortCode.
//   2. ARCHIVED or missing → 404.
//   3. ACTIVE → record the click (per-click row + counter increment),
//      set the `sv_attribution` cookie (90 days, the spec's decision
//      Q1.2 = C) so a user who bounces and comes back later still
//      lands on this link's attribution at submit time, and 302 to
//      the link's destination.
//
// No rate limiting in this PR — deferred. A bot flood would inflate
// clickCount and write rows to tracking_link_clicks; OWNER can spot
// abuse there and archive the link.

@Controller('s')
export class ShortLinkController {
  constructor(private readonly links: TrackingLinksService) {}

  @Get(':shortCode')
  async redirect(
    @Param('shortCode') shortCode: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const result = await this.links.recordClick(shortCode, req);
    if (!result) {
      res.status(404).send('Link not found.');
      return;
    }
    // 90-day attribution cookie. The path is `/` so it travels to the
    // scorecard form on any sub-route. Lax SameSite so it survives
    // a same-site GET navigation from the redirect, but doesn't leak
    // cross-site. httpOnly: false because the form's client-side code
    // may want to read it as a fallback before the server gets a turn.
    res.cookie('sv_attribution', result.linkId, {
      maxAge: 90 * 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
    });
    res.redirect(302, result.destination);
  }
}
