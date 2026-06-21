import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DigestService, type SendClientDigestResult } from './digest.service';
import { SendDigestDto } from './dto/send-digest.dto';

// Phase 8 — manual staff-only digest trigger.
//
// Sole purpose: prove the gather → render → send chain end-to-end
// against the real test client before the Friday cron lands. The
// future cron sweeps every active case automatically; this endpoint
// fires ONE digest at ONE case on demand from a trusted admin.
//
// Restricted to OWNER / ADMIN / SUPER_ADMIN. Other staff roles can't
// trigger this — it's not a per-case helper, it's an admin/testing
// affordance and would be confusing in workflows that don't need it.

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

@Controller('digest')
export class DigestController {
  constructor(private readonly digest: DigestService) {}

  @Post('case/:caseId/send')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')
  async sendOne(
    @Param('caseId') caseId: string,
    @Body() dto: SendDigestDto,
    @Req() req: any,
  ): Promise<SendClientDigestResult> {
    // Resolve the date window. Defaults:
    //   • neither given → last 7 days (until = now, since = until - 7d)
    //   • until-only    → since = until - 7d  (the week ending {until})
    //   • since-only    → until = now         (everything since {since})
    //   • both given    → as-is, validated below
    // Anchoring `since` to `until - 7d` on the until-only path is what
    // makes the manual trigger useful for back-tests: pass last
    // Tuesday as `until` and you get last Tue-prev-Tue, not a window
    // starting last Tuesday and ending today.
    const now   = new Date();
    const until = dto.until ? new Date(dto.until) : now;
    const since = dto.since
      ? new Date(dto.since)
      : new Date(until.getTime() - SEVEN_DAYS_MS);

    // Defensive parse check — class-validator's @IsDateString rejects
    // malformed strings, but a string like "2026-13-99" can sneak past
    // it on some Node versions. Re-check the resulting Date object.
    if (Number.isNaN(since.getTime())) {
      throw new BadRequestException('since is not a valid date');
    }
    if (Number.isNaN(until.getTime())) {
      throw new BadRequestException('until is not a valid date');
    }
    if (since.getTime() >= until.getTime()) {
      throw new BadRequestException('since must be before until');
    }

    const actor = {
      id:   req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };

    return this.digest.triggerManualDigest(caseId, since, until, actor);
  }
}
