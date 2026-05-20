import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

// PR-DASH-4 — Per-user DB-count rate limits for chatbot routes.
//
// Same pattern as PR-DASH-2's TicketCreationRateLimitGuard /
// PR-DASH-3's ConsultantMeetingsWriteRateLimitGuard. We can't use
// the existing IP-keyed throttler because it would punish students
// behind a shared NAT (e.g. campus WiFi).
//
// Limits per spec:
//   * Create conversation: 10 / hour
//   * Send message:        30 / 10 min
//   * Escalate:             5 / hour

@Injectable()
export class ChatbotConversationCreateRateLimitGuard implements CanActivate {
  private readonly LIMIT = 10;
  private readonly WINDOW_MS = 60 * 60 * 1000;
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    if (!userId) return true;
    const since = new Date(Date.now() - this.WINDOW_MS);
    const count = await this.prisma.visaChatConversation.count({
      where: { studentId: userId, createdAt: { gte: since } },
    });
    if (count >= this.LIMIT) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'CHATBOT_RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

@Injectable()
export class ChatbotMessageRateLimitGuard implements CanActivate {
  private readonly LIMIT = 30;
  private readonly WINDOW_MS = 10 * 60 * 1000;
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    if (!userId) return true;
    const since = new Date(Date.now() - this.WINDOW_MS);
    // Count USER messages this student has written across all their
    // conversations. JOIN through conversation → studentId.
    const count = await this.prisma.visaChatMessage.count({
      where: {
        role:      'USER',
        createdAt: { gte: since },
        conversation: { studentId: userId },
      },
    });
    if (count >= this.LIMIT) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'CHATBOT_RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

@Injectable()
export class ChatbotEscalationRateLimitGuard implements CanActivate {
  private readonly LIMIT = 5;
  private readonly WINDOW_MS = 60 * 60 * 1000;
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    if (!userId) return true;
    const since = new Date(Date.now() - this.WINDOW_MS);
    const count = await this.prisma.auditLog.count({
      where: {
        userId,
        eventType: { in: ['CHAT_ESCALATION_ACCEPTED', 'CHAT_ESCALATION_DECLINED'] },
        createdAt: { gte: since },
      },
    });
    if (count >= this.LIMIT) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'CHATBOT_RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
