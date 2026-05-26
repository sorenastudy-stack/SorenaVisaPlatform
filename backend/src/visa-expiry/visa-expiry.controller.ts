import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { VisaExpiryService } from './visa-expiry.service';

// PR-LIA-9 — Expiry-reminder dashboard endpoint + manual sweep trigger.
//
// Mounted under /staff/visa-expiry so it lives next to PR-LIA-3's
// productivity routes (same role gates / same controller cluster).
//
// All routes use req.user?.userId ?? req.user?.id per d95640d.

@Controller('staff/visa-expiry')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VisaExpiryController {
  constructor(
    private readonly service: VisaExpiryService,
    private readonly prisma: PrismaService,
  ) {}

  // GET /staff/visa-expiry/expiring-soon
  //
  // Returns the queue for the LIA dashboard + dedicated page. LIA
  // included in the gate — every LIA needs to see "their" cases in
  // the queue. Filtering is intentionally NOT scoped to viewer here;
  // the frontend can render a "Mine" chip if/when needed.
  @Get('expiring-soon')
  @Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
  async expiringSoon(@Query('thresholdDays') thresholdDays?: string) {
    const t = thresholdDays ? parseInt(thresholdDays, 10) : 30;
    const clamped = Number.isFinite(t) && t > 0 && t <= 365 ? t : 30;
    return this.service.getExpiringSoon(clamped);
  }

  // POST /staff/visa-expiry/run-sweep-now
  //
  // Manual trigger — OWNER / ADMIN / SUPER_ADMIN only. Intentionally
  // not LIA-accessible: we don't want a curious LIA to blast 100
  // emails by clicking a "test" button. Useful for:
  //   * catch-up after the backend was down at 09:00 NZ
  //   * staging-env smoke tests
  //   * post-bugfix retry
  // Deduplication via the unique constraint makes this safe to call
  // any number of times in a row.
  @Post('run-sweep-now')
  @Roles('OWNER', 'ADMIN', 'SUPER_ADMIN')
  async runSweepNow(@Req() req: any) {
    const actor = this.actor(req);
    const result = await this.service.dispatchRemindersForThresholds([30, 14, 7], actor);

    // Top-level audit row recording the manual trigger — distinct
    // from the per-reminder VISA_EXPIRY_REMINDER_SENT_* rows that the
    // service writes itself.
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: actor.id ?? null,
          action: 'CREATE',
          eventType: 'VISA_EXPIRY_MANUAL_SWEEP_TRIGGERED',
          entityType: 'SYSTEM',
          entityId: null,
          newValue: {
            dispatched: result.dispatched,
            skipped: result.skipped,
            failed: result.failed,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    } catch {
      // Audit failure is non-fatal — the sweep already wrote its own
      // per-recipient audit rows.
    }

    return result;
  }

  private actor(req: any) {
    return {
      // PR-LIA-d95640d: JwtStrategy.validate returns { userId, ... }.
      id: req.user?.userId ?? req.user?.id ?? null,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
