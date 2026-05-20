import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

// PR-CONSULT-1 — DB-count rate limits per project convention.
// 30 auto-allocations / hour / staff user. 60 manual assignments
// / hour / staff user.

@Injectable()
export class AutoAllocateRateLimitGuard implements CanActivate {
  private readonly LIMIT = 30;
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
        eventType: 'STAFF_ASSIGNED_AUTO',
        createdAt: { gte: since },
      },
    });
    if (count >= this.LIMIT) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'ASSIGNMENT_RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

@Injectable()
export class ManualAssignRateLimitGuard implements CanActivate {
  private readonly LIMIT = 60;
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
        eventType: { in: ['STAFF_ASSIGNED_MANUAL', 'STAFF_REASSIGNED'] },
        createdAt: { gte: since },
      },
    });
    if (count >= this.LIMIT) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'ASSIGNMENT_RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
