import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { STAFF_ROLES_KEY, StaffAccessRole } from './staff-roles.decorator';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';

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
    const required = this.reflector.getAllAndOverride<StaffAccessRole[] | undefined>(
      STAFF_ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    // FAIL CLOSED: a route behind StaffRolesGuard with no @StaffRoles/@OwnerOnly/
    // @AdminTier is denied by default (mirrors the RolesGuard fail-closed fix).
    // The old `return true` here would have exposed any staff route that forgot
    // its role decorator.
    if (!required || required.length === 0) {
      // Deferral: if the route is governed by @Roles (the separate RolesGuard),
      // that guard is its authority — don't double-deny. No route combines the
      // two today; this keeps the flip safe if one ever does.
      const roles = this.reflector.getAllAndOverride<string[] | undefined>(
        ROLES_KEY,
        [ctx.getHandler(), ctx.getClass()],
      );
      if (roles && roles.length > 0) return true;
      throw new ForbiddenException(
        'This action requires a staff role that has not been granted.',
      );
    }

    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.userId || !user?.role) {
      throw new ForbiddenException('Authentication required');
    }
    if (!required.includes(user.role as StaffAccessRole)) {
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
