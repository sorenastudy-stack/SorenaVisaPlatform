import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

// PR-DASH-2 — Per-user rate limit for ticket creation.
//
// The project's existing @nestjs/throttler instance is IP-keyed
// (60 reqs / 60s default), which is fine for cheap reads but
// inadequate for "10 tickets per CLIENT per 24h" (shared IPs would
// punish unrelated users). This guard does a single fast SELECT
// count against the visa_support_tickets table for the requesting
// user inside a 24-hour window. On overshoot it raises HTTP 429
// with an i18n key the frontend turns into a toast message.
@Injectable()
export class TicketCreationRateLimitGuard implements CanActivate {
  // 10 tickets per 24h rolling window. The values live here rather
  // than on the @Throttle decorator because we're not using the
  // throttler.
  private readonly LIMIT = 10;
  private readonly WINDOW_MS = 24 * 60 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    if (!userId) return true; // JwtAuthGuard runs first; the missing-user case is its concern.

    const since = new Date(Date.now() - this.WINDOW_MS);
    const count = await this.prisma.visaSupportTicket.count({
      where: {
        clientId:  userId,
        createdAt: { gte: since },
      },
    });
    if (count >= this.LIMIT) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, messageKey: 'tickets.errors.rateLimitExceeded' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

// PR-DASH-2 — Per-user rate limit for message posts.
//
// 60 messages per hour across all of the user's tickets. Same query-
// based approach as the creation guard; the (ticketId, createdAt)
// index plus a small WHERE on authorRole = CLIENT keeps the count
// query fast.
@Injectable()
export class TicketMessageRateLimitGuard implements CanActivate {
  private readonly LIMIT = 60;
  private readonly WINDOW_MS = 60 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    if (!userId) return true;

    const since = new Date(Date.now() - this.WINDOW_MS);
    const count = await this.prisma.visaSupportTicketMessage.count({
      where: {
        authorId:   userId,
        authorRole: 'CLIENT',
        createdAt:  { gte: since },
      },
    });
    if (count >= this.LIMIT) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, messageKey: 'tickets.errors.messageRateLimit' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
