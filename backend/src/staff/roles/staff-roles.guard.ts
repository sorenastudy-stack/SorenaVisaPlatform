import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { STAFF_ROLES_KEY, StaffRole } from './staff-roles.decorator';

// PR-CONSULT-1 — Staff-roles guard.
//
// Two checks on top of the existing RolesGuard:
//   1. `req.user.role` is in the @StaffRoles(...) allow-list.
//   2. The user's StaffActiveStatus row (if it exists) has
//      isActive=true. Staff who don't have a StaffActiveStatus row
//      yet are considered active — only an explicit deactivation
//      creates a row with isActive=false.
//
// JwtAuthGuard must run before this guard (it populates req.user).
// We don't re-validate the JWT here.
@Injectable()
export class StaffRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(
      STAFF_ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    // Route doesn't declare any staff-role requirement → allow.
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.userId || !user?.role) {
      throw new ForbiddenException('Authentication required');
    }
    if (!required.includes(user.role as StaffRole)) {
      throw new ForbiddenException(
        `Role ${user.role} is not allowed for this action`,
      );
    }
    // Active-check — only fail if there's an explicit deactivation
    // row with isActive=false. Missing row = treat as active so the
    // guard doesn't break the moment new staff sign in.
    const active = await this.prisma.staffActiveStatus.findUnique({
      where:  { userId: user.userId },
      select: { isActive: true },
    });
    if (active && active.isActive === false) {
      throw new ForbiddenException('Staff account is deactivated');
    }
    return true;
  }
}
