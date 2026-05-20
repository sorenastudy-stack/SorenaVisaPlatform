import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

// PR-DASH-3 — Per-user DB-count rate limits.
//
// Matches the PR-DASH-2 pattern (TicketCreationRateLimitGuard +
// TicketMessageRateLimitGuard). The existing @nestjs/throttler is
// IP-keyed which would punish shared-network deployments — these
// guards count rows the calling user owns in a trailing window
// instead, so each account is rate-limited independently.

// Student-side list endpoint protection. 120 reads / minute is
// generous but enough to surface obviously-broken polling loops.
@Injectable()
export class StudentMeetingsListRateLimitGuard implements CanActivate {
  private readonly LIMIT = 120;
  private readonly WINDOW_MS = 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    if (!userId) return true;
    const since = new Date(Date.now() - this.WINDOW_MS);
    const count = await this.prisma.auditLog.count({
      where: {
        userId,
        eventType: 'MEETINGS_LIST_VIEWED',
        createdAt: { gte: since },
      },
    });
    if (count >= this.LIMIT) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, messageKey: 'meetings.errors.staffRateLimit' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

// Consultant-side write protection. 50 mutations / hour across
// create / update / transcript-metadata / transcript-notes. We
// count distinct meeting rows touched plus transcript writes
// attributed to this consultant. Covers the multi-endpoint write
// surface from a single counter.
@Injectable()
export class ConsultantMeetingsWriteRateLimitGuard implements CanActivate {
  private readonly LIMIT = 50;
  private readonly WINDOW_MS = 60 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    if (!userId) return true;
    const since = new Date(Date.now() - this.WINDOW_MS);
    const [meetingCount, transcriptCount] = await Promise.all([
      this.prisma.visaMeeting.count({
        where: { consultantId: userId, updatedAt: { gte: since } },
      }),
      this.prisma.visaMeetingTranscript.count({
        where: { uploadedById: userId, uploadedAt: { gte: since } },
      }),
    ]);
    if (meetingCount + transcriptCount >= this.LIMIT) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, messageKey: 'meetings.errors.staffRateLimit' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
