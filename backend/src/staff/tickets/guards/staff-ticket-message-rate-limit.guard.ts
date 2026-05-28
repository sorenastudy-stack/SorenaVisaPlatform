import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

// PR-SUPPORT-1 — Per-staff-user rate limit for staff ticket replies.
//
// Mirrors students/tickets/guards/ticket-rate-limit.guards.ts's
// TicketMessageRateLimitGuard but with a wider window because a
// support agent handling 30+ tickets per shift will legitimately
// post many more messages than a single client.
//
// 200 staff-authored messages per hour rolling. The (ticketId,
// createdAt) index plus the `authorRole = STAFF` filter keeps the
// count query cheap.

@Injectable()
export class StaffTicketMessageRateLimitGuard implements CanActivate {
  private readonly LIMIT = 200;
  private readonly WINDOW_MS = 60 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) return true; // JwtAuthGuard fires first.

    const since = new Date(Date.now() - this.WINDOW_MS);
    const count = await this.prisma.visaSupportTicketMessage.count({
      where: {
        authorId:   userId,
        authorRole: 'STAFF',
        createdAt:  { gte: since },
      },
    });
    if (count >= this.LIMIT) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, messageKey: 'tickets.errors.staffMessageRateLimit' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
