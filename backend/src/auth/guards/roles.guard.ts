import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { hasRole } from '../role.util';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
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
