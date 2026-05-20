import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

// PR-CONSULT-1 — Per-user DB-count rate limits.
//   * POST /owner-approval         — 50 / hour / super_admin
//   * POST /:id/approve            — 100 / hour / owner
//   * POST /:id/reject             — 100 / hour / owner

@Injectable()
export class OwnerApprovalCreateRateLimitGuard implements CanActivate {
  private readonly LIMIT = 50;
  private readonly WINDOW_MS = 60 * 60 * 1000;
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    if (!userId) return true;
    const since = new Date(Date.now() - this.WINDOW_MS);
    const count = await this.prisma.ownerApprovalRequest.count({
      where: { requestedById: userId, createdAt: { gte: since } },
    });
    if (count >= this.LIMIT) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'OWNER_APPROVAL_RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

@Injectable()
export class OwnerApprovalDecisionRateLimitGuard implements CanActivate {
  private readonly LIMIT = 100;
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
        eventType: { in: ['OWNER_APPROVAL_APPROVED', 'OWNER_APPROVAL_REJECTED'] },
        createdAt: { gte: since },
      },
    });
    if (count >= this.LIMIT) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'OWNER_APPROVAL_RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
