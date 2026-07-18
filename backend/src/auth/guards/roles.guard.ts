import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { STAFF_ROLES_KEY } from '../../staff/roles/staff-roles.decorator';
import { hasRole } from '../role.util';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // FAIL CLOSED. A route placed behind RolesGuard with no @Roles is denied by
    // default. The previous `return true` here (fail-open) is exactly what left
    // seven controllers readable by any authenticated user. A new ungated route
    // now 403s (visible) instead of leaking (silent) — the safe direction.
    if (!requiredRoles || requiredRoles.length === 0) {
      // One deliberate exception: a route governed by @StaffRoles is the
      // domain of the separate StaffRolesGuard — defer to it instead of
      // double-denying. No route combines RolesGuard with @StaffRoles today;
      // this guarantees the flip can never lock a staff route out even if one
      // day one does.
      const staffRoles = this.reflector.getAllAndOverride<string[]>(STAFF_ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (staffRoles && staffRoles.length > 0) {
        return true;
      }
      throw new ForbiddenException(
        'This action is not permitted: no role grant is configured for it.',
      );
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Widen with secondary roles: allowed if PRIMARY role OR any secondary role
    // is in requiredRoles. Empty secondaryRoles → identical to the old check.
    if (!hasRole(user, ...requiredRoles)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
