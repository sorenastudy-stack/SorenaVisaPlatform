import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

// PR-CONSULT-4 — DB-count rate limits.
//
// 60 profile updates / hour / actor — generous because edits are
// non-destructive and a single admin shift can easily touch a
// dozen profiles.
// 10 hard deletes / hour / actor — far tighter; this is the most
// destructive op on the platform.

@Injectable()
export class UpdateProfileRateLimitGuard implements CanActivate {
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
        eventType: 'STAFF_PROFILE_UPDATED',
        createdAt: { gte: since },
      },
    });
    if (count >= this.LIMIT) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'STAFF_PROFILE_UPDATE_RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

@Injectable()
export class HardDeleteRateLimitGuard implements CanActivate {
  private readonly LIMIT = 10;
  private readonly WINDOW_MS = 60 * 60 * 1000;
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    if (!userId) return true;
    const since = new Date(Date.now() - this.WINDOW_MS);
    // Count direct (OWNER inline) hard deletes only. SUPER_ADMIN's
    // queued path is rate-limited by the existing OwnerApprovalCreate
    // guard from PR-CONSULT-1 (50/h) which covers the queued case.
    const count = await this.prisma.auditLog.count({
      where: {
        userId,
        eventType: 'STAFF_HARD_DELETED',
        createdAt: { gte: since },
      },
    });
    if (count >= this.LIMIT) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'HARD_DELETE_RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
